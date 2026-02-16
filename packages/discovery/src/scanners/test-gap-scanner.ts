import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { Task, TaskComplexity, TaskSource } from "@oac/core";
import type { ScanOptions, Scanner } from "../types.js";

const DEFAULT_EXCLUDES = [".git", "node_modules", "dist", "build", "coverage"] as const;

type ComplexityBucket = "small" | "medium" | "large";

/**
 * Scanner that identifies source files lacking corresponding test files.
 */
export class TestGapScanner implements Scanner {
  public readonly id: TaskSource | string = "test-gap";
  public readonly name = "Test Gap Scanner";

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    const maxTasks = options.maxTasks;
    if (typeof maxTasks === "number" && maxTasks === 0) {
      return [];
    }

    const excludes = mergeExcludes(options.exclude);
    const { sourceFiles, testFiles } = await collectCandidateFiles(repoPath, excludes);
    if (sourceFiles.length === 0) {
      return [];
    }

    const coveredSourceKeys = buildCoveredSourceKeySet(testFiles);
    const untestedSourceFiles = sourceFiles.filter(
      (sourceFilePath) => !coveredSourceKeys.has(toSourceKey(sourceFilePath)),
    );

    if (untestedSourceFiles.length === 0) {
      return [];
    }

    const cappedSourceFiles =
      typeof maxTasks === "number" && maxTasks > 0
        ? untestedSourceFiles.slice(0, maxTasks)
        : untestedSourceFiles;

    const discoveredAt = new Date().toISOString();
    const tasks: Task[] = [];

    for (const sourceFilePath of cappedSourceFiles) {
      const absolutePath = resolve(repoPath, sourceFilePath);

      let fileContent = "";
      let fileSizeBytes = 0;
      try {
        const [content, fileStats] = await Promise.all([
          readFile(absolutePath, "utf8"),
          stat(absolutePath),
        ]);
        fileContent = content;
        fileSizeBytes = fileStats.size;
      } catch {
        continue;
      }

      const lineCount = countLines(fileContent);
      const complexityBucket = toComplexityBucket(lineCount);
      const complexity = toTaskComplexity(complexityBucket);
      const estimatedTokens = estimateTokens(complexityBucket);
      const symbols = extractSymbols(fileContent);

      const task: Task = {
        id: createTaskId(sourceFilePath),
        source: "test-gap" as TaskSource,
        title: `Add tests for ${basename(sourceFilePath)}`,
        description: buildDescription(sourceFilePath, symbols),
        targetFiles: [sourceFilePath],
        priority: 0,
        complexity,
        executionMode: "new-pr",
        metadata: {
          scannerId: "test-gap",
          filePath: sourceFilePath,
          lineCount,
          fileSizeBytes,
          complexityBucket,
          estimatedTokens,
          symbols,
        },
        discoveredAt,
      };

      tasks.push(task);
    }

    return tasks;
  }
}

async function collectCandidateFiles(
  repoPath: string,
  excludePatterns: string[],
): Promise<{ sourceFiles: string[]; testFiles: string[] }> {
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const excludeMatchers = excludePatterns.map(compileGlobMatcher);

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = resolve(repoPath, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      const relativePath = normalizeRelativePath(
        relativeDir ? `${relativeDir}/${entryName}` : entryName,
      );

      if (excludeMatchers.some((matches) => matches(relativePath))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isSourceFile(relativePath)) {
        sourceFiles.push(relativePath);
      }

      if (isTestFile(relativePath)) {
        testFiles.push(relativePath);
      }
    }
  }

  await walk("");

  sourceFiles.sort((left, right) => left.localeCompare(right));
  testFiles.sort((left, right) => left.localeCompare(right));

  return { sourceFiles, testFiles };
}

function isSourceFile(filePath: string): boolean {
  if (!filePath.endsWith(".ts")) {
    return false;
  }

  if (filePath.endsWith(".d.ts") || filePath.endsWith(".test.ts")) {
    return false;
  }

  if (basename(filePath) === "index.ts") {
    return false;
  }

  const parts = filePath.split("/");
  return parts.includes("src");
}

function isTestFile(filePath: string): boolean {
  if (!filePath.endsWith(".test.ts")) {
    return false;
  }

  const parts = filePath.split("/");
  return parts.includes("tests") || parts.includes("__tests__");
}

function buildCoveredSourceKeySet(testFiles: string[]): Set<string> {
  const covered = new Set<string>();

  for (const testFilePath of testFiles) {
    const candidateSourceKeys = deriveCandidateSourceKeysFromTest(testFilePath);
    for (const sourceKey of candidateSourceKeys) {
      covered.add(sourceKey);
    }
  }

  return covered;
}

function deriveCandidateSourceKeysFromTest(testFilePath: string): string[] {
  const normalized = normalizeRelativePath(testFilePath);
  if (!normalized.endsWith(".test.ts")) {
    return [];
  }

  const withoutSuffix = normalized.slice(0, -".test.ts".length);
  const parts = withoutSuffix.split("/");
  const markerIndex = parts.findIndex((part) => part === "tests" || part === "__tests__");
  if (markerIndex < 0) {
    return [];
  }

  const prefix = parts.slice(0, markerIndex);
  const suffix = parts.slice(markerIndex + 1);

  const candidates = new Set<string>();
  candidates.add(normalizeRelativePath([...prefix, "src", ...suffix].join("/")));

  if (prefix[prefix.length - 1] === "src") {
    candidates.add(normalizeRelativePath([...prefix, ...suffix].join("/")));
  }

  return [...candidates];
}

function toSourceKey(sourceFilePath: string): string {
  const normalized = normalizeRelativePath(sourceFilePath);
  return normalized.endsWith(".ts") ? normalized.slice(0, -".ts".length) : normalized;
}

function buildDescription(sourceFilePath: string, symbols: string[]): string {
  if (symbols.length === 0) {
    return `Add initial test coverage for \`${sourceFilePath}\`. No named functions or classes were detected.`;
  }

  const symbolList = symbols.map((symbol) => `\`${symbol}\``).join(", ");
  return `Add test coverage for \`${sourceFilePath}\`, including: ${symbolList}.`;
}

function extractSymbols(fileContent: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    match = pattern.exec(fileContent);
    while (match) {
      const symbolName = match[1];
      if (symbolName) {
        symbols.add(symbolName);
      }
      match = pattern.exec(fileContent);
    }
  }

  return [...symbols].sort((left, right) => left.localeCompare(right));
}

function countLines(fileContent: string): number {
  if (fileContent.length === 0) {
    return 0;
  }
  return fileContent.split(/\r?\n/).length;
}

function toComplexityBucket(lineCount: number): ComplexityBucket {
  if (lineCount < 50) {
    return "small";
  }
  if (lineCount < 200) {
    return "medium";
  }
  return "large";
}

function toTaskComplexity(bucket: ComplexityBucket): TaskComplexity {
  if (bucket === "small") {
    return "simple";
  }
  if (bucket === "medium") {
    return "moderate";
  }
  return "complex";
}

function estimateTokens(bucket: ComplexityBucket): number {
  if (bucket === "small") {
    return 1_500;
  }
  if (bucket === "medium") {
    return 4_000;
  }
  return 8_000;
}

function createTaskId(sourceFilePath: string): string {
  return createHash("sha256").update(sourceFilePath).digest("hex").slice(0, 16);
}

function mergeExcludes(exclude: string[] | undefined): string[] {
  return Array.from(new Set([...DEFAULT_EXCLUDES, ...(exclude ?? [])].filter(Boolean)));
}

function compileGlobMatcher(pattern: string): (filePath: string) => boolean {
  const normalized = normalizeRelativePath(pattern.replace(/^!+/, "").trim());
  if (!normalized) {
    return () => false;
  }

  if (!normalized.includes("*")) {
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return (filePath: string) =>
      filePath === normalized || filePath.startsWith(prefix) || filePath.endsWith(`/${normalized}`);
  }

  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");

  const regex = new RegExp(`^${escaped}$`);
  return (filePath: string) => regex.test(filePath);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(sep).join("/");
}
