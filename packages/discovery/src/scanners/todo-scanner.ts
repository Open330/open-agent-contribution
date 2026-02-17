import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Task, TaskComplexity } from "@oac/core";
import type { ScanOptions, Scanner } from "../types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const TODO_GROUPING_WINDOW = 10;
const TODO_RG_PATTERN = "\\b(TODO|FIXME|HACK|XXX)\\b";
const TODO_KEYWORD_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/i;
const TODO_TEXT_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]?(.*)$/i;
const COMMENT_CONTINUATION_PATTERN = /^\s*(?:\/\/|\/\*+|\*|#|--)/;
const MAX_FUNCTION_LOOKBACK_LINES = 80;
const DEFAULT_EXCLUDES = [".git", "node_modules", "dist", "build", "coverage"];

const FUNCTION_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:public|private|protected|static|readonly|\s)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
  /^\s*def\s+([A-Za-z_]\w*)\s*\(/,
] as const;

interface TodoMatch {
  filePath: string;
  line: number;
  column: number;
  keyword: string;
  text: string;
}

interface TodoCluster {
  filePath: string;
  matches: TodoMatch[];
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
 * Scanner that converts TODO-like markers into actionable tasks.
 */
export class TodoScanner implements Scanner {
  public readonly id = "todo";
  public readonly name = "TODO Scanner";

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    const matches = await this.findTodoMatches(repoPath, options);
    if (matches.length === 0) {
      return [];
    }

    const grouped = groupTodoMatches(matches, TODO_GROUPING_WINDOW);
    const fileCache = new Map<string, string[]>();
    const now = new Date().toISOString();

    const tasks: Task[] = [];

    for (const cluster of grouped) {
      const fileLines = await getFileLines(repoPath, cluster.filePath, fileCache);
      const task = buildTodoTask(cluster, fileLines, now);
      tasks.push(task);
    }

    if (typeof options.maxTasks === "number" && options.maxTasks >= 0) {
      return tasks.slice(0, options.maxTasks);
    }

    return tasks;
  }

  private async findTodoMatches(repoPath: string, options: ScanOptions): Promise<TodoMatch[]> {
    try {
      return await findTodoMatchesWithRipgrep(repoPath, options);
    } catch (error) {
      if (isCommandNotFound(error)) {
        return findTodoMatchesWithFsFallback(repoPath, options);
      }
      throw error;
    }
  }
}

async function findTodoMatchesWithRipgrep(
  repoPath: string,
  options: ScanOptions,
): Promise<TodoMatch[]> {
  const args = ["--json", "--line-number", "--column"];
  if (options.includeHidden) {
    args.push("--hidden");
  }

  const excludes = mergeExcludes(options.exclude);
  for (const pattern of excludes) {
    args.push("--glob", toRgExclude(pattern));
  }

  args.push("-e", TODO_RG_PATTERN, ".");

  const result = await runCommand("rg", args, {
    cwd: repoPath,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  });

  if (result.timedOut) {
    throw new Error(`TODO scanner timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
  }

  if (result.exitCode === 1 && result.stdout.trim().length === 0) {
    return [];
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`ripgrep failed: ${result.stderr || result.stdout}`);
  }

  return parseRipgrepJson(result.stdout);
}

function parseRipgrepJson(output: string): TodoMatch[] {
  const matches: TodoMatch[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = toRecord(parsed);
    if (record.type !== "match") {
      continue;
    }

    const data = toRecord(record.data);
    const pathRecord = toRecord(data.path);
    const linesRecord = toRecord(data.lines);

    const rawFilePath = asString(pathRecord.text);
    const rawText = asString(linesRecord.text);
    const filePath = rawFilePath ? normalizeRelativePath(rawFilePath) : undefined;
    const lineNumber = asNumber(data.line_number);
    const text = rawText ? sanitizeLine(rawText) : undefined;
    const submatches = asArray(data.submatches);
    const firstSubmatch = toRecord(submatches.at(0));
    const column = (asNumber(firstSubmatch.start) ?? 0) + 1;

    if (!filePath || !lineNumber || !text) {
      continue;
    }

    const keyword = extractTodoKeyword(text) ?? "TODO";

    matches.push({
      filePath,
      line: lineNumber,
      column,
      keyword,
      text,
    });
  }

  return matches;
}

async function findTodoMatchesWithFsFallback(
  repoPath: string,
  options: ScanOptions,
): Promise<TodoMatch[]> {
  const excludes = mergeExcludes(options.exclude);
  const files = await collectFiles(repoPath, excludes);
  const matches: TodoMatch[] = [];

  for (const filePath of files) {
    const absolutePath = resolve(repoPath, filePath);
    let content = "";
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index] ?? "";
      if (!TODO_KEYWORD_PATTERN.test(lineText)) {
        continue;
      }

      const keyword = extractTodoKeyword(lineText) ?? "TODO";
      const columnIndex = lineText.search(TODO_KEYWORD_PATTERN);

      matches.push({
        filePath,
        line: index + 1,
        column: columnIndex >= 0 ? columnIndex + 1 : 1,
        keyword,
        text: sanitizeLine(lineText),
      });
    }
  }

  return matches;
}

function groupTodoMatches(matches: TodoMatch[], lineWindow: number): TodoCluster[] {
  const sorted = [...matches].sort((left, right) => {
    const byFile = left.filePath.localeCompare(right.filePath);
    if (byFile !== 0) {
      return byFile;
    }
    return left.line - right.line;
  });

  const groups: TodoCluster[] = [];
  let active: TodoCluster | undefined;

  for (const match of sorted) {
    if (!active) {
      active = { filePath: match.filePath, matches: [match] };
      groups.push(active);
      continue;
    }

    const last = active.matches[active.matches.length - 1];
    const sameFile = active.filePath === match.filePath;
    if (sameFile && last && match.line - last.line <= lineWindow) {
      active.matches.push(match);
      continue;
    }

    active = { filePath: match.filePath, matches: [match] };
    groups.push(active);
  }

  return groups;
}

async function getFileLines(
  repoPath: string,
  filePath: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }

  try {
    const text = await readFile(resolve(repoPath, filePath), "utf8");
    const lines = text.split(/\r?\n/);
    cache.set(filePath, lines);
    return lines;
  } catch {
    const empty: string[] = [];
    cache.set(filePath, empty);
    return empty;
  }
}

function buildTodoTask(cluster: TodoCluster, fileLines: string[], discoveredAt: string): Task {
  const first = cluster.matches[0];
  const last = cluster.matches[cluster.matches.length - 1];

  const functionName = first ? findNearestFunctionName(fileLines, first.line) : undefined;
  const isMultiLine = cluster.matches.some((match) => isMultiLineTodo(match, fileLines));
  const complexity: TaskComplexity =
    cluster.matches.length > 1 || isMultiLine ? "simple" : "trivial";

  const title = first
    ? `Address TODO comments in ${cluster.filePath}:${first.line}`
    : `Address TODO comments in ${cluster.filePath}`;

  const todoSummary = cluster.matches
    .map((match) => `- ${match.keyword} at line ${match.line}: ${truncate(match.text, 140)}`)
    .join("\n");

  const descriptionParts = [
    `Resolve TODO-style markers in \`${cluster.filePath}\`.`,
    functionName ? `Nearest function context: \`${functionName}\`.` : undefined,
    "Markers discovered:",
    todoSummary,
  ].filter((part): part is string => Boolean(part));

  const description = descriptionParts.join("\n\n");
  const uniqueKeywords = Array.from(
    new Set(cluster.matches.map((match) => match.keyword.toUpperCase())),
  );
  const stableHashInput = [
    cluster.filePath,
    String(first?.line ?? 0),
    String(last?.line ?? 0),
    uniqueKeywords.join(","),
    cluster.matches.map((match) => match.text).join("\n"),
  ].join("::");

  const task: Task = {
    id: createTaskId("todo", [cluster.filePath], title, stableHashInput),
    source: "todo",
    title,
    description,
    targetFiles: [cluster.filePath],
    priority: 0,
    complexity,
    executionMode: "new-pr",
    metadata: {
      scannerId: "todo",
      filePath: cluster.filePath,
      startLine: first?.line ?? null,
      endLine: last?.line ?? null,
      functionName: functionName ?? null,
      keywordSet: uniqueKeywords,
      matchCount: cluster.matches.length,
      matches: cluster.matches.map((match) => ({
        line: match.line,
        column: match.column,
        keyword: match.keyword,
        text: match.text,
      })),
    },
    discoveredAt,
  };

  return task;
}

function findNearestFunctionName(fileLines: string[], lineNumber: number): string | undefined {
  if (lineNumber <= 0 || fileLines.length === 0) {
    return undefined;
  }

  const startIndex = Math.max(0, lineNumber - 1 - MAX_FUNCTION_LOOKBACK_LINES);
  for (let index = lineNumber - 1; index >= startIndex; index -= 1) {
    const candidate = fileLines[index]?.trim();
    if (!candidate || candidate.startsWith("//")) {
      continue;
    }

    for (const pattern of FUNCTION_PATTERNS) {
      const match = candidate.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  return undefined;
}

function isMultiLineTodo(match: TodoMatch, fileLines: string[]): boolean {
  const baseIndex = match.line - 1;
  const line = fileLines[baseIndex + 1];
  if (line === undefined) {
    return false;
  }

  const trimmed = line.trim();
  if (trimmed.length === 0 || TODO_KEYWORD_PATTERN.test(trimmed)) {
    return false;
  }

  if (COMMENT_CONTINUATION_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

function extractTodoKeyword(lineText: string): string | undefined {
  const match = lineText.match(TODO_TEXT_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].toUpperCase();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function createTaskId(
  source: string,
  targetFiles: string[],
  title: string,
  suffix: string,
): string {
  const base = [source, [...targetFiles].sort().join(","), title, suffix].join("::");
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

function mergeExcludes(exclude: string[] | undefined): string[] {
  return Array.from(new Set([...DEFAULT_EXCLUDES, ...(exclude ?? [])].filter(Boolean)));
}

function toRgExclude(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed.startsWith("!")) {
    return trimmed;
  }
  return `!${trimmed}`;
}

async function collectFiles(rootDir: string, excludes: string[]): Promise<string[]> {
  const files: string[] = [];
  const compiledExcludes = excludes.map(compileGlobMatcher);

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = resolve(rootDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      const relPath = normalizeRelativePath(
        relativeDir ? `${relativeDir}/${entryName}` : entryName,
      );
      if (compiledExcludes.some((matches) => matches(relPath))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(relPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  await walk("");
  return files;
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

function sanitizeLine(line: string): string {
  return line.replace(/\r?\n/g, "").trim();
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

function isCommandNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeNodeError = error as NodeJS.ErrnoException;
  return maybeNodeError.code === "ENOENT";
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
