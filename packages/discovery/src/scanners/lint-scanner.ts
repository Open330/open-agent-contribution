import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Task, TaskComplexity } from "@oac/core";
import type { ScanOptions, Scanner } from "../types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type LinterKind = "eslint" | "biome" | "none";

interface LinterDetection {
  kind: LinterKind;
  packageManager: PackageManager;
}

interface LintFinding {
  filePath: string;
  line?: number;
  column?: number;
  ruleId: string;
  message: string;
  fixable: boolean;
  severity?: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

interface CommandOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Scanner that runs repo-native lint tooling and maps findings to tasks.
 */
export class LintScanner implements Scanner {
  public readonly id = "lint";
  public readonly name = "Lint Scanner";

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    const detection = await detectLinter(repoPath);
    if (detection.kind === "none") {
      return [];
    }

    const result = await runLinter(repoPath, detection, options);
    const findings =
      detection.kind === "eslint"
        ? parseEslintFindings(result.stdout, repoPath)
        : parseBiomeFindings(result.stdout, repoPath);

    if (findings.length === 0) {
      return [];
    }

    const tasks = buildLintTasks(findings, detection.kind);
    if (typeof options.maxTasks === "number" && options.maxTasks >= 0) {
      return tasks.slice(0, options.maxTasks);
    }

    return tasks;
  }
}

async function detectLinter(repoPath: string): Promise<LinterDetection> {
  const packageManager = await detectPackageManager(repoPath);
  const packageJson = await readPackageJson(repoPath);

  const scriptLint = asString(toRecord(packageJson.scripts).lint)?.toLowerCase() ?? "";
  const dependencies = collectDependencyNames(packageJson);

  if (scriptLint.includes("biome")) {
    return { kind: "biome", packageManager };
  }
  if (scriptLint.includes("eslint")) {
    return { kind: "eslint", packageManager };
  }

  if (dependencies.has("eslint") || (await hasAnyFile(repoPath, ESLINT_CONFIG_FILES))) {
    return { kind: "eslint", packageManager };
  }
  if (dependencies.has("@biomejs/biome") || (await hasAnyFile(repoPath, BIOME_CONFIG_FILES))) {
    return { kind: "biome", packageManager };
  }

  return { kind: "none", packageManager };
}

const ESLINT_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.cjs",
  ".eslintrc.js",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
] as const;

const BIOME_CONFIG_FILES = ["biome.json", "biome.jsonc"] as const;

async function detectPackageManager(repoPath: string): Promise<PackageManager> {
  const checks: Array<{ file: string; manager: PackageManager }> = [
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "bun.lockb", manager: "bun" },
    { file: "bun.lock", manager: "bun" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "package-lock.json", manager: "npm" },
  ];

  for (const check of checks) {
    if (await fileExists(resolve(repoPath, check.file))) {
      return check.manager;
    }
  }

  return "npm";
}

async function runLinter(
  repoPath: string,
  detection: LinterDetection,
  options: ScanOptions,
): Promise<CommandResult> {
  const command = buildLintCommand(detection, options);
  const result = await runCommand(command.command, command.args, {
    cwd: repoPath,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  });

  if (result.timedOut) {
    throw new Error(`Lint scanner timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
  }

  const output = result.stdout.trim();

  // ESLint and Biome both return non-zero exit codes when lint violations exist.
  if (result.exitCode !== 0 && output.length === 0) {
    return {
      ...result,
      stdout: normalizeJsonText(result.stderr),
    };
  }

  return {
    ...result,
    stdout: normalizeJsonText(result.stdout),
  };
}

function buildLintCommand(
  detection: LinterDetection,
  options: ScanOptions,
): { command: string; args: string[] } {
  const excludes = options.exclude ?? [];

  if (detection.kind === "eslint") {
    const eslintArgs = ["eslint", ".", "--format", "json", "--no-error-on-unmatched-pattern"];
    for (const pattern of excludes) {
      eslintArgs.push("--ignore-pattern", pattern);
    }
    return withPackageManagerRunner(detection.packageManager, eslintArgs);
  }

  const biomeArgs = ["biome", "check", ".", "--reporter=json"];
  return withPackageManagerRunner(detection.packageManager, biomeArgs);
}

function withPackageManagerRunner(
  packageManager: PackageManager,
  commandArgs: string[],
): { command: string; args: string[] } {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: ["exec", ...commandArgs] };
  }

  if (packageManager === "yarn") {
    return { command: "yarn", args: commandArgs };
  }

  if (packageManager === "bun") {
    return { command: "bunx", args: commandArgs };
  }

  return { command: "npx", args: ["--no-install", ...commandArgs] };
}

function parseEslintFindings(output: string, repoPath: string): LintFinding[] {
  const parsed = parseJson(output);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const findings: LintFinding[] = [];
  for (const result of parsed) {
    const resultRecord = toRecord(result);
    const filePathValue = asString(resultRecord.filePath);
    const filePath = normalizeFilePath(filePathValue, repoPath);
    if (!filePath) {
      continue;
    }

    const messages = asArray(resultRecord.messages);
    for (const message of messages) {
      const messageRecord = toRecord(message);
      const ruleId = asString(messageRecord.ruleId) ?? "unknown";
      const text = asString(messageRecord.message);
      if (!text) {
        continue;
      }

      findings.push({
        filePath,
        line: asNumber(messageRecord.line),
        column: asNumber(messageRecord.column),
        ruleId,
        message: text,
        fixable: messageRecord.fix !== undefined,
        severity: asNumber(messageRecord.severity),
      });
    }
  }

  return findings;
}

function parseBiomeFindings(output: string, repoPath: string): LintFinding[] {
  const parsed = parseJson(output);
  if (parsed === undefined) {
    return [];
  }

  const diagnostics = collectBiomeDiagnostics(parsed);
  const findings: LintFinding[] = [];

  for (const diagnostic of diagnostics) {
    const path = extractBiomePath(diagnostic);
    const filePath = normalizeFilePath(path, repoPath);
    if (!filePath) {
      continue;
    }

    const message =
      asString(diagnostic.description) ??
      asString(diagnostic.message) ??
      asString(diagnostic.reason);
    if (!message) {
      continue;
    }

    const category = asString(diagnostic.category) ?? "unknown";
    const position = extractBiomePosition(diagnostic);
    const tags = asArray(diagnostic.tags).map((value) => String(value).toLowerCase());

    findings.push({
      filePath,
      line: position?.line,
      column: position?.column,
      ruleId: category,
      message,
      fixable:
        tags.includes("fixable") ||
        tags.includes("quickfix") ||
        diagnostic.suggestedFixes !== undefined,
      severity: normalizeBiomeSeverity(asString(diagnostic.severity)),
    });
  }

  return findings;
}

function collectBiomeDiagnostics(value: unknown): Array<Record<string, unknown>> {
  const diagnostics: Array<Record<string, unknown>> = [];
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (looksLikeBiomeDiagnostic(record)) {
      diagnostics.push(record);
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value) || (value && typeof value === "object")) {
        queue.push(value);
      }
    }
  }

  return diagnostics;
}

function looksLikeBiomeDiagnostic(record: Record<string, unknown>): boolean {
  if (record.location !== undefined && record.category !== undefined) {
    return true;
  }
  if (
    record.path !== undefined &&
    (record.description !== undefined || record.message !== undefined)
  ) {
    return true;
  }
  return false;
}

function extractBiomePath(diagnostic: Record<string, unknown>): string | undefined {
  const location = toRecord(diagnostic.location);
  const pathValue = location.path;
  if (typeof pathValue === "string") {
    return pathValue;
  }

  const pathRecord = toRecord(pathValue);
  const file = asString(pathRecord.file);
  if (file) {
    return file;
  }

  return asString(diagnostic.filePath);
}

function extractBiomePosition(
  diagnostic: Record<string, unknown>,
): { line?: number; column?: number } | undefined {
  const location = toRecord(diagnostic.location);
  const span = toRecord(location.span);
  const start = toRecord(span.start);

  const line = asNumber(start.line);
  const column = asNumber(start.column);
  if (line !== undefined || column !== undefined) {
    return { line, column };
  }

  const lineFallback = asNumber(location.line) ?? asNumber(diagnostic.line);
  const columnFallback = asNumber(location.column) ?? asNumber(diagnostic.column);
  if (lineFallback !== undefined || columnFallback !== undefined) {
    return { line: lineFallback, column: columnFallback };
  }

  return undefined;
}

function normalizeBiomeSeverity(severity: string | undefined): number | undefined {
  if (!severity) {
    return undefined;
  }
  const normalized = severity.toLowerCase();
  if (normalized === "error") {
    return 2;
  }
  if (normalized === "warning" || normalized === "warn") {
    return 1;
  }
  return undefined;
}

function buildLintTasks(findings: LintFinding[], linter: "eslint" | "biome"): Task[] {
  const grouped = new Map<string, LintFinding[]>();
  for (const finding of findings) {
    const existing = grouped.get(finding.filePath);
    if (existing) {
      existing.push(finding);
    } else {
      grouped.set(finding.filePath, [finding]);
    }
  }

  const discoveredAt = new Date().toISOString();
  const tasks: Task[] = [];

  for (const [filePath, fileFindings] of grouped.entries()) {
    const uniqueRules = Array.from(new Set(fileFindings.map((finding) => finding.ruleId)));
    const fixableCount = fileFindings.filter((finding) => finding.fixable).length;
    const complexity: TaskComplexity =
      fileFindings.length === 1 && fixableCount === 1 ? "trivial" : "simple";

    const headlineRules = uniqueRules.slice(0, 5).join(", ") || "unknown";
    const title = `Fix lint findings in ${filePath}`;
    const description = [
      `Resolve ${fileFindings.length} lint finding(s) reported by ${linter} in \`${filePath}\`.`,
      `Primary rules: ${headlineRules}.`,
      fixableCount > 0
        ? `${fixableCount} finding(s) appear auto-fixable.`
        : "No auto-fixable findings were detected.",
    ].join("\n\n");

    const task: Task = {
      id: createTaskId("lint", [filePath], title, `${linter}:${headlineRules}`),
      source: "lint",
      title,
      description,
      targetFiles: [filePath],
      priority: 0,
      complexity,
      executionMode: "new-pr",
      metadata: {
        scannerId: "lint",
        linter,
        filePath,
        issueCount: fileFindings.length,
        ruleIds: uniqueRules,
        fixableCount,
        findings: fileFindings.map((finding) => ({
          line: finding.line ?? null,
          column: finding.column ?? null,
          ruleId: finding.ruleId,
          message: finding.message,
          fixable: finding.fixable,
          severity: finding.severity ?? null,
        })),
      },
      discoveredAt,
    };

    tasks.push(task);
  }

  return tasks;
}

function createTaskId(
  source: string,
  targetFiles: string[],
  title: string,
  suffix: string,
): string {
  const content = [source, [...targetFiles].sort().join(","), title, suffix].join("::");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function readPackageJson(repoPath: string): Promise<Record<string, unknown>> {
  const packageJsonPath = resolve(repoPath, "package.json");
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return toRecord(parsed);
  } catch {
    return {};
  }
}

function collectDependencyNames(packageJson: Record<string, unknown>): Set<string> {
  const sections = [
    toRecord(packageJson.dependencies),
    toRecord(packageJson.devDependencies),
    toRecord(packageJson.peerDependencies),
    toRecord(packageJson.optionalDependencies),
  ];

  const names = new Set<string>();
  for (const section of sections) {
    for (const key of Object.keys(section)) {
      names.add(key);
    }
  }
  return names;
}

async function hasAnyFile(repoPath: string, candidates: readonly string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await fileExists(resolve(repoPath, candidate))) {
      return true;
    }
  }
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFilePath(filePath: string | undefined, repoPath: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  if (filePath.startsWith("<")) {
    return undefined;
  }

  const absoluteCandidate = resolve(repoPath, filePath);
  const rel = relative(repoPath, absoluteCandidate);
  if (!rel.startsWith("..")) {
    return rel.split(sep).join("/");
  }

  const direct = filePath.split(sep).join("/");
  return direct;
}

function normalizeJsonText(text: string): string {
  return text.trim();
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    const jsonStart = text.indexOf("[");
    const objectStart = text.indexOf("{");
    const start =
      jsonStart === -1
        ? objectStart
        : objectStart === -1
          ? jsonStart
          : Math.min(jsonStart, objectStart);

    if (start < 0) {
      return undefined;
    }

    const trimmed = text.slice(start).trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killHandle: NodeJS.Timeout | undefined;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killHandle = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      if (killHandle) {
        clearTimeout(killHandle);
      }
      rejectPromise(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutHandle);
      if (killHandle) {
        clearTimeout(killHandle);
      }

      resolvePromise({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
      });
    });
  });
}
