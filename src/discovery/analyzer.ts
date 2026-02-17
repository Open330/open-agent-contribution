import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import type { Task, TaskSource } from "../core/types.js";
import type { CodebaseMap, FileInfo, ModuleInfo, QualityReport } from "./context-types.js";
import { CompositeScanner } from "./scanner.js";
import type { RawFinding, ScanOptions, Scanner } from "./types.js";

// ── Public types ─────────────────────────────────────────────

export interface AnalyzeOptions {
  /** Glob patterns to exclude (e.g., ["dist/**", "node_modules/**"]) */
  exclude?: string[];
  /** Scanners to use. If not provided, uses default CompositeScanner scanners */
  scanners?: Scanner[];
  /** Source directory name to analyze (default: "src") */
  sourceDir?: string;
  /** Resolved repo metadata (passed to scanners) */
  repoFullName?: string;
  headSha?: string;
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const DEFAULT_EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

const DEFAULT_EXCLUDE_SUFFIXES = [
  ".d.ts",
  ".test.ts",
  ".spec.ts",
  ".test.tsx",
  ".spec.tsx",
  ".test.js",
  ".spec.js",
  ".test.jsx",
  ".spec.jsx",
];

const DEFAULT_MAX_AGE_MS = 86_400_000; // 24 hours

const CONTEXT_DIR_NAME = ".oac/context";
const CODEBASE_MAP_FILE = "codebase-map.json";
const QUALITY_REPORT_FILE = "quality-report.json";

// ── analyzeCodebase ──────────────────────────────────────────

export async function analyzeCodebase(
  repoPath: string,
  options?: AnalyzeOptions,
): Promise<{ codebaseMap: CodebaseMap; qualityReport: QualityReport }> {
  const resolvedRepoPath = resolve(repoPath);
  const sourceDir = options?.sourceDir ?? "src";
  const srcRoot = join(resolvedRepoPath, sourceDir);
  const userExclude = options?.exclude ?? [];
  const repoFullName = options?.repoFullName ?? "";
  const headSha = options?.headSha ?? "";

  // ── 1. Walk file tree ──────────────────────────────────────
  const allFiles = await walkSourceFiles(srcRoot, userExclude);

  // ── 2. Analyze each file ───────────────────────────────────
  const fileInfos: Array<FileInfo & { _absolutePath: string }> = [];
  for (const absPath of allFiles) {
    const relPath = relative(resolvedRepoPath, absPath);
    const info = await analyzeFile(absPath, relPath);
    fileInfos.push({ ...info, _absolutePath: absPath });
  }

  // ── 3. Detect modules ─────────────────────────────────────
  const moduleMap = buildModuleMap(fileInfos, sourceDir);

  // ── 4. Resolve module dependencies ─────────────────────────
  const moduleNames = new Set(Object.keys(moduleMap));
  const modules: ModuleInfo[] = [];

  for (const [moduleName, files] of Object.entries(moduleMap)) {
    const moduleFiles: FileInfo[] = files.map(({ _absolutePath: _, ...fi }) => fi);
    const totalLoc = moduleFiles.reduce((sum, f) => sum + f.loc, 0);
    const allExports = moduleFiles.flatMap((f) => f.exports);
    const dependencies = resolveModuleDependencies(files, moduleName, sourceDir, moduleNames);

    modules.push({
      name: moduleName,
      path: moduleName === "root" ? sourceDir : `${sourceDir}/${moduleName}`,
      files: moduleFiles,
      totalLoc,
      exports: allExports,
      dependencies,
    });
  }

  const totalFiles = fileInfos.length;
  const totalLoc = fileInfos.reduce((sum, f) => sum + f.loc, 0);
  const generatedAt = new Date().toISOString();

  const codebaseMap: CodebaseMap = {
    version: 1,
    generatedAt,
    repoFullName,
    headSha,
    modules,
    totalFiles,
    totalLoc,
  };

  // ── 5. Run scanners → RawFinding[] ─────────────────────────
  const findings = await runScanners(resolvedRepoPath, sourceDir, options);

  // ── 6. Build QualityReport ─────────────────────────────────
  const qualityReport = buildQualityReport(findings, repoFullName, generatedAt);

  return { codebaseMap, qualityReport };
}

// ── persistContext ────────────────────────────────────────────

export async function persistContext(
  repoPath: string,
  codebaseMap: CodebaseMap,
  qualityReport: QualityReport,
  contextDir?: string,
): Promise<string> {
  const resolvedDir = contextDir ? resolve(contextDir) : join(resolve(repoPath), CONTEXT_DIR_NAME);

  await mkdir(resolvedDir, { recursive: true });

  await atomicWriteJson(join(resolvedDir, CODEBASE_MAP_FILE), codebaseMap);
  await atomicWriteJson(join(resolvedDir, QUALITY_REPORT_FILE), qualityReport);

  return resolvedDir;
}

// ── loadContext ───────────────────────────────────────────────

export async function loadContext(
  repoPath: string,
  contextDir?: string,
): Promise<{ codebaseMap: CodebaseMap; qualityReport: QualityReport } | null> {
  const resolvedDir = contextDir ? resolve(contextDir) : join(resolve(repoPath), CONTEXT_DIR_NAME);

  try {
    const [mapRaw, reportRaw] = await Promise.all([
      readFile(join(resolvedDir, CODEBASE_MAP_FILE), "utf-8"),
      readFile(join(resolvedDir, QUALITY_REPORT_FILE), "utf-8"),
    ]);
    const codebaseMap = JSON.parse(mapRaw) as CodebaseMap;
    const qualityReport = JSON.parse(reportRaw) as QualityReport;
    return { codebaseMap, qualityReport };
  } catch {
    return null;
  }
}

// ── isContextStale ───────────────────────────────────────────

export function isContextStale(
  codebaseMap: CodebaseMap,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): boolean {
  const generatedAt = new Date(codebaseMap.generatedAt).getTime();
  if (Number.isNaN(generatedAt)) {
    return true;
  }
  return Date.now() - generatedAt > maxAgeMs;
}

// ── deriveModuleFromPath ─────────────────────────────────────

/**
 * Extracts the module name from a file path relative to the repo root.
 *
 * Examples:
 *   src/budget/planner.ts  → "budget"
 *   src/core/types.ts      → "core"
 *   src/cli/commands/run.ts → "cli"
 *   src/index.ts            → "root"
 *   lib/utils.ts            → "root"
 */
export function deriveModuleFromPath(filePath: string, sourceDir = "src"): string {
  // Normalize separators to forward slashes for consistent matching
  const normalized = filePath.replace(/\\/g, "/");
  const prefix = `${sourceDir.replace(/\\/g, "/")}/`;

  if (!normalized.startsWith(prefix)) {
    return "root";
  }

  const afterSrc = normalized.slice(prefix.length);
  const firstSlash = afterSrc.indexOf("/");
  if (firstSlash === -1) {
    // File is directly in sourceDir, e.g. src/index.ts
    return "root";
  }

  return afterSrc.slice(0, firstSlash);
}

// ── Internal: file walking ───────────────────────────────────

async function walkSourceFiles(dirPath: string, userExclude: string[]): Promise<string[]> {
  const results: string[] = [];

  // Build a set of user-specified directory names to exclude (simple patterns)
  const userExcludeDirs = new Set<string>();
  const userExcludeSuffixes: string[] = [];
  for (const pattern of userExclude) {
    // Strip trailing /** or /* for directory-based exclusion
    const cleaned = pattern.replace(/\/\*{1,2}$/, "");
    if (cleaned.startsWith("*.")) {
      userExcludeSuffixes.push(cleaned.slice(1)); // e.g. ".map"
    } else {
      userExcludeDirs.add(cleaned);
    }
  }

  function isExcludedFile(name: string): boolean {
    if (!DEFAULT_EXTENSIONS.has(extname(name))) return true;
    if (DEFAULT_EXCLUDE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
    if (userExcludeSuffixes.some((suffix) => name.endsWith(suffix))) return true;
    return false;
  }

  function isExcludedDir(name: string): boolean {
    return DEFAULT_EXCLUDE_DIRS.has(name) || userExcludeDirs.has(name);
  }

  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !isExcludedDir(entry.name)) {
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && !isExcludedFile(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
  }

  await walk(dirPath);
  results.sort();
  return results;
}

// ── Internal: single-file analysis ───────────────────────────

async function analyzeFile(absolutePath: string, relativePath: string): Promise<FileInfo> {
  const [content, fileStat] = await Promise.all([
    readFile(absolutePath, "utf-8"),
    stat(absolutePath),
  ]);

  const lines = content.split("\n");
  const loc = lines.filter((line) => line.trim().length > 0).length;
  const exports = extractExports(content);
  const imports = extractImports(content);

  return {
    path: relativePath,
    loc,
    sizeBytes: fileStat.size,
    exports,
    imports,
  };
}

// ── Internal: export extraction ──────────────────────────────

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const seen = new Set<string>();

  const add = (name: string): void => {
    const trimmed = name.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      exports.push(trimmed);
    }
  };

  // export function/class/const/let/var/type/interface/enum NAME
  const namedDeclRe =
    /\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const m of content.matchAll(namedDeclRe)) {
    add(m[1]);
  }

  // export { Name, Name as Alias, ... }
  const bracedRe = /\bexport\s*\{([^}]+)\}/g;
  for (const m of content.matchAll(bracedRe)) {
    const inner = m[1];
    for (const item of inner.split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      const exportedName = parts.length > 1 ? parts[1].trim() : parts[0].trim();
      if (exportedName) {
        add(exportedName);
      }
    }
  }

  // export default
  const defaultRe = /\bexport\s+default\b/;
  if (defaultRe.test(content)) {
    add("default");
  }

  return exports;
}

// ── Internal: import extraction ──────────────────────────────

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  const add = (path: string): void => {
    const trimmed = path.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      imports.push(trimmed);
    }
  };

  // import ... from "PATH"  or  import "PATH"
  const staticImportRe = /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of content.matchAll(staticImportRe)) {
    add(m[1]);
  }

  // import("PATH")
  const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of content.matchAll(dynamicImportRe)) {
    add(m[1]);
  }

  return imports;
}

// ── Internal: module map building ────────────────────────────

function buildModuleMap(
  fileInfos: Array<FileInfo & { _absolutePath: string }>,
  sourceDir: string,
): Record<string, Array<FileInfo & { _absolutePath: string }>> {
  const moduleMap: Record<string, Array<FileInfo & { _absolutePath: string }>> = {};

  for (const fi of fileInfos) {
    const moduleName = deriveModuleFromPath(fi.path, sourceDir);
    if (!moduleMap[moduleName]) {
      moduleMap[moduleName] = [];
    }
    moduleMap[moduleName].push(fi);
  }

  return moduleMap;
}

// ── Internal: module dependency resolution ───────────────────

function resolveModuleDependencies(
  files: Array<FileInfo & { _absolutePath: string }>,
  currentModule: string,
  sourceDir: string,
  allModuleNames: Set<string>,
): string[] {
  const deps = new Set<string>();

  for (const file of files) {
    for (const importPath of file.imports) {
      // Only consider relative imports — node_modules imports are ignored
      if (!importPath.startsWith(".")) continue;

      // Resolve the import relative to the file's directory
      const fileDir = dirname(file.path);
      const resolvedImport = join(fileDir, importPath).replace(/\\/g, "/");
      const importModule = deriveModuleFromPath(resolvedImport, sourceDir);

      if (importModule !== currentModule && allModuleNames.has(importModule)) {
        deps.add(importModule);
      }
    }
  }

  return [...deps].sort();
}

// ── Internal: scanner execution ──────────────────────────────

async function runScanners(
  repoPath: string,
  sourceDir: string,
  options?: AnalyzeOptions,
): Promise<RawFinding[]> {
  const scanners = options?.scanners;
  const composite = scanners ? new CompositeScanner(scanners) : new CompositeScanner();

  const scanOptions: ScanOptions = {
    exclude: options?.exclude,
  };

  let tasks: Task[];
  try {
    tasks = await composite.scan(repoPath, scanOptions);
  } catch {
    // If scanning fails entirely, return an empty findings list
    tasks = [];
  }

  return tasks.map((task) => taskToRawFinding(task, sourceDir));
}

// ── Internal: Task → RawFinding conversion ───────────────────

function taskToRawFinding(task: Task, sourceDir: string): RawFinding {
  const filePath = task.targetFiles[0] ?? "";
  const scannerId =
    typeof task.metadata?.scannerId === "string" ? task.metadata.scannerId : task.source;

  return {
    scannerId,
    source: task.source,
    filePath,
    module: deriveModuleFromPath(filePath, sourceDir),
    title: task.title,
    description: task.description,
    severity: deriveSeverity(task.source),
    complexity: task.complexity,
    line: typeof task.metadata?.startLine === "number" ? task.metadata.startLine : undefined,
    metadata: task.metadata,
    discoveredAt: task.discoveredAt,
  };
}

function deriveSeverity(source: TaskSource): "info" | "warning" | "error" {
  switch (source) {
    case "lint":
      return "warning";
    case "todo":
      return "info";
    case "test-gap":
      return "info";
    case "github-issue":
      return "warning";
    case "dead-code":
      return "warning";
    case "custom":
      return "info";
    default:
      return "info";
  }
}

// ── Internal: QualityReport building ─────────────────────────

function buildQualityReport(
  findings: RawFinding[],
  repoFullName: string,
  generatedAt: string,
): QualityReport {
  const bySource: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const finding of findings) {
    bySource[finding.source] = (bySource[finding.source] ?? 0) + 1;
    const mod = finding.module ?? "root";
    byModule[mod] = (byModule[mod] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }

  return {
    version: 1,
    generatedAt,
    repoFullName,
    findings,
    summary: {
      totalFindings: findings.length,
      bySource,
      byModule,
      bySeverity,
    },
  };
}

// ── Internal: atomic JSON write ──────────────────────────────

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  const content = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
