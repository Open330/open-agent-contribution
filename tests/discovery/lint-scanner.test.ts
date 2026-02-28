import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("node:fs/promises", () => ({
  access: fsMocks.access,
  readFile: fsMocks.readFile,
}));

import { LintScanner } from "../../src/discovery/scanners/lint-scanner.js";

const mockedSpawn = vi.mocked(spawn);
const mockedAccess = vi.mocked(access);
const mockedReadFile = vi.mocked(readFile);
const REPO_PATH = "/repo";

interface SpawnResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  emitError?: Error;
  closeDelayMs?: number;
}

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

let queuedSpawnResults: SpawnResult[] = [];

function createErrno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function queueSpawnResult(result: SpawnResult): void {
  queuedSpawnResults.push(result);
}

function createMockChildProcess(result: SpawnResult): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  setTimeout(() => {
    if (result.stdout) {
      child.stdout.write(result.stdout);
    }
    if (result.stderr) {
      child.stderr.write(result.stderr);
    }
    child.stdout.end();
    child.stderr.end();

    if (result.emitError) {
      child.emit("error", result.emitError);
      return;
    }

    child.emit("close", result.exitCode ?? 0, result.signal ?? null);
  }, result.closeDelayMs ?? 0);

  return child;
}

function mockExistingFiles(relativePaths: string[]): void {
  const existing = new Set(relativePaths.map((path) => resolve(REPO_PATH, path)));
  mockedAccess.mockImplementation(async (filePath) => {
    if (existing.has(String(filePath))) {
      return;
    }
    throw createErrno("ENOENT");
  });
}

function mockPackageJson(value: Record<string, unknown>): void {
  const packageJsonPath = resolve(REPO_PATH, "package.json");
  mockedReadFile.mockImplementation(async (filePath) => {
    if (String(filePath) === packageJsonPath) {
      return JSON.stringify(value);
    }
    throw createErrno("ENOENT");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queuedSpawnResults = [];

  mockExistingFiles([]);
  mockPackageJson({});

  mockedSpawn.mockImplementation(() => {
    const next = queuedSpawnResults.shift() ?? {
      stdout: "[]",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
    return createMockChildProcess(next) as unknown as ChildProcessWithoutNullStreams;
  });
});

describe("LintScanner", () => {
  it("detects ESLint when eslint config exists", async () => {
    mockExistingFiles([".eslintrc.json"]);
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("npx");
    expect(args).toEqual(
      expect.arrayContaining(["--no-install", "eslint", ".", "--format", "json"]),
    );
  });

  it("detects Biome when biome.json exists", async () => {
    mockExistingFiles(["biome.json"]);
    queueSpawnResult({ stdout: "{}", exitCode: 0 });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("npx");
    expect(args).toEqual(
      expect.arrayContaining(["--no-install", "biome", "check", ".", "--reporter=json"]),
    );
  });

  it("falls back to none when no linter is found", async () => {
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("parses ESLint JSON output into lint tasks", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/app.ts",
          messages: [
            {
              ruleId: "no-unused-vars",
              message: "x is defined but never used.",
              line: 7,
              column: 3,
              severity: 2,
              fix: { range: [0, 1], text: "" },
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const [task] = tasks;
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
    const findings = (metadata.findings ?? []) as Array<Record<string, unknown>>;

    expect(tasks).toHaveLength(1);
    expect(task?.targetFiles).toEqual(["src/app.ts"]);
    expect(task?.complexity).toBe("trivial");
    expect(metadata.issueCount).toBe(1);
    expect(metadata.fixableCount).toBe(1);
    expect(metadata.ruleIds).toEqual(["no-unused-vars"]);
    expect(findings[0]).toMatchObject({
      line: 7,
      column: 3,
      ruleId: "no-unused-vars",
      fixable: true,
      severity: 2,
    });
  });

  it("parses Biome JSON output correctly", async () => {
    mockPackageJson({ scripts: { lint: "biome check ." } });
    queueSpawnResult({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: "lint/style/noConsole",
            severity: "warning",
            description: "Avoid console.log in production code.",
            tags: ["fixable"],
            location: {
              path: { file: "src/logger.ts" },
              span: { start: { line: 12, column: 5 } },
            },
          },
        ],
      }),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const [task] = tasks;
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
    const findings = (metadata.findings ?? []) as Array<Record<string, unknown>>;

    expect(tasks).toHaveLength(1);
    expect(task?.targetFiles).toEqual(["src/logger.ts"]);
    expect(task?.complexity).toBe("trivial");
    expect(metadata.linter).toBe("biome");
    expect(metadata.ruleIds).toEqual(["lint/style/noConsole"]);
    expect(findings[0]).toMatchObject({
      line: 12,
      column: 5,
      ruleId: "lint/style/noConsole",
      fixable: true,
      severity: 1,
    });
  });

  it("maps fixable findings to trivial complexity", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "src/fixable.ts",
          messages: [
            {
              ruleId: "semi",
              message: "Missing semicolon.",
              line: 1,
              column: 10,
              severity: 1,
              fix: { range: [0, 1], text: ";" },
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const [task] = await scanner.scan(REPO_PATH);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;

    expect(task?.complexity).toBe("trivial");
    expect(metadata.fixableCount).toBe(1);
  });

  it("handles linter timeout gracefully", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: "[]",
      exitCode: 0,
      closeDelayMs: 30,
    });
    const scanner = new LintScanner();

    await expect(scanner.scan(REPO_PATH, { timeoutMs: 5 })).rejects.toThrow(
      "Lint scanner timed out after 5ms",
    );

    const child = mockedSpawn.mock.results[0]?.value as unknown as MockChildProcess;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("handles non-zero linter exit by parsing stderr fallback output", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: "",
      stderr: JSON.stringify([
        {
          filePath: "src/problem.ts",
          messages: [
            {
              ruleId: "no-alert",
              message: "Unexpected alert.",
              line: 3,
              column: 1,
              severity: 2,
            },
          ],
        },
      ]),
      exitCode: 2,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const [task] = tasks;

    expect(tasks).toHaveLength(1);
    expect(task?.targetFiles).toEqual(["src/problem.ts"]);
  });

  it("respects maxTasks option", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "src/alpha.ts",
          messages: [{ ruleId: "no-console", message: "a", line: 1, column: 1, severity: 1 }],
        },
        {
          filePath: "src/beta.ts",
          messages: [{ ruleId: "no-alert", message: "b", line: 2, column: 1, severity: 1 }],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 1 });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/alpha.ts"]);
  });

  it("respects exclude patterns", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH, { exclude: ["dist/**", "coverage/**"] });

    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("npx");
    expect(args).toEqual(
      expect.arrayContaining([
        "--ignore-pattern",
        "dist/**",
        "--ignore-pattern",
        "coverage/**",
      ]),
    );
  });

  it("deduplicates findings by file and rule", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/dup.ts",
          messages: [
            {
              ruleId: "no-alert",
              message: "Unexpected alert.",
              line: 2,
              column: 1,
              severity: 2,
            },
            {
              ruleId: "no-alert",
              message: "Unexpected alert again.",
              line: 8,
              column: 1,
              severity: 2,
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const metadata = (tasks[0]?.metadata ?? {}) as Record<string, unknown>;
    const findings = (metadata.findings ?? []) as unknown[];

    // The scanner deduplicates findings by file+ruleId, keeping only the first occurrence
    expect(tasks).toHaveLength(1);
    expect(metadata.issueCount).toBe(1);
    expect(metadata.ruleIds).toEqual(["no-alert"]);
    expect(findings).toHaveLength(1);
  });

  it("keeps multiple findings with different ruleIds in the same file", async () => {
    mockPackageJson({ dependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/multi.ts",
          messages: [
            {
              ruleId: "no-alert",
              message: "Unexpected alert.",
              line: 2,
              column: 1,
              severity: 2,
            },
            {
              ruleId: "no-console",
              message: "Unexpected console statement.",
              line: 8,
              column: 1,
              severity: 1,
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const metadata = (tasks[0]?.metadata ?? {}) as Record<string, unknown>;
    const findings = (metadata.findings ?? []) as unknown[];

    // Different ruleIds are preserved
    expect(tasks).toHaveLength(1);
    expect(metadata.issueCount).toBe(2);
    expect((metadata.ruleIds as string[]).sort()).toEqual(["no-alert", "no-console"]);
    expect(findings).toHaveLength(2);
  });

  it("has correct id and name", () => {
    const scanner = new LintScanner();
    expect(scanner.id).toBe("lint");
    expect(scanner.name).toBe("Lint Scanner");
  });

  it("detects ESLint from lint script in package.json", async () => {
    mockPackageJson({ scripts: { lint: "eslint ." } });
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("npx");
    expect(args).toContain("eslint");
  });

  it("detects Biome from lint script in package.json", async () => {
    mockPackageJson({ scripts: { lint: "biome check ." } });
    queueSpawnResult({ stdout: "{}", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("biome");
  });

  it("prefers biome over eslint when lint script mentions biome", async () => {
    mockPackageJson({
      scripts: { lint: "biome check ." },
      devDependencies: { eslint: "^8.0.0", "@biomejs/biome": "^1.0.0" },
    });
    queueSpawnResult({ stdout: "{}", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("biome");
    expect(args).not.toContain("eslint");
  });

  it("detects eslint from devDependencies when no lint script exists", async () => {
    mockPackageJson({ devDependencies: { eslint: "^8.0.0" } });
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("eslint");
  });

  it("detects biome from @biomejs/biome dependency", async () => {
    mockPackageJson({ devDependencies: { "@biomejs/biome": "^1.0.0" } });
    queueSpawnResult({ stdout: "{}", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("biome");
  });

  it("uses pnpm exec when pnpm-lock.yaml exists", async () => {
    mockExistingFiles(["pnpm-lock.yaml", ".eslintrc.json"]);
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("pnpm");
    expect(args[0]).toBe("exec");
  });

  it("uses yarn when yarn.lock exists", async () => {
    mockExistingFiles(["yarn.lock", ".eslintrc.json"]);
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [command] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("yarn");
  });

  it("uses bunx when bun.lockb exists", async () => {
    mockExistingFiles(["bun.lockb", ".eslintrc.json"]);
    queueSpawnResult({ stdout: "[]", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [command] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("bunx");
  });

  it("returns empty when ESLint produces non-JSON output", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({ stdout: "not valid json at all", exitCode: 1 });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("skips messages without a message text", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/a.ts",
          messages: [
            { ruleId: "no-unused-vars", line: 1, column: 1, severity: 2 },
            {
              ruleId: "no-console",
              message: "Unexpected console",
              line: 5,
              column: 1,
              severity: 1,
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect((tasks[0]?.metadata as Record<string, unknown>).issueCount).toBe(1);
  });

  it("handles missing ruleId gracefully", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/a.ts",
          messages: [{ message: "Something is wrong", line: 1, column: 1, severity: 2 }],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect((tasks[0]?.metadata as Record<string, unknown>).ruleIds).toContain("unknown");
  });

  it("parses JSON even with leading non-JSON text (prefixed output)", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    const jsonPart = JSON.stringify([
      {
        filePath: "/repo/src/a.ts",
        messages: [{ ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 }],
      },
    ]);
    queueSpawnResult({ stdout: `some warning text\n${jsonPart}`, exitCode: 1 });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
  });

  it("sets complexity to simple for multiple findings in a file", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/a.ts",
          messages: [
            { ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 },
            { ruleId: "no-console", message: "No console", line: 2, column: 1, severity: 1 },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks[0]?.complexity).toBe("simple");
  });

  it("generates stable task IDs for the same input", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    const output = JSON.stringify([
      {
        filePath: "/repo/src/stable.ts",
        messages: [{ ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 }],
      },
    ]);

    queueSpawnResult({ stdout: output, exitCode: 1 });
    const scanner = new LintScanner();
    const tasks1 = await scanner.scan(REPO_PATH);

    queueSpawnResult({ stdout: output, exitCode: 1 });
    const tasks2 = await scanner.scan(REPO_PATH);

    expect(tasks1[0]?.id).toBe(tasks2[0]?.id);
    expect(tasks1[0]?.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("includes title, description, and metadata fields", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/foo.ts",
          messages: [
            { ruleId: "no-unused-vars", message: "x is unused", line: 5, column: 2, severity: 2 },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const task = tasks[0]!;

    expect(task.title).toBe("Fix lint findings in src/foo.ts");
    expect(task.description).toContain("1 lint finding(s)");
    expect(task.description).toContain("eslint");
    expect(task.description).toContain("no-unused-vars");
    expect(task.executionMode).toBe("new-pr");
    expect(task.priority).toBe(0);
    expect(task.metadata.scannerId).toBe("lint");
  });

  it("returns no tasks when maxTasks is 0", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/a.ts",
          messages: [{ ruleId: "r", message: "m", line: 1, column: 1, severity: 2 }],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 0 });

    expect(tasks).toEqual([]);
  });

  it("skips file paths starting with '<'", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "<text>",
          messages: [{ ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 }],
        },
        {
          filePath: "/repo/src/real.ts",
          messages: [{ ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 }],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/real.ts"]);
  });

  it("normalizes absolute file paths relative to repoPath", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/deep/nested.ts",
          messages: [{ ruleId: "no-var", message: "Use let", line: 1, column: 1, severity: 2 }],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks[0]?.targetFiles).toEqual(["src/deep/nested.ts"]);
  });

  it("rejects when spawn emits an error", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({ emitError: new Error("ENOENT: command not found") });
    const scanner = new LintScanner();

    await expect(scanner.scan(REPO_PATH)).rejects.toThrow("ENOENT");
  });

  it("creates tasks for multiple files with separate findings", async () => {
    mockPackageJson({ devDependencies: { eslint: "^9.0.0" } });
    queueSpawnResult({
      stdout: JSON.stringify([
        {
          filePath: "/repo/src/alpha.ts",
          messages: [
            { ruleId: "no-unused-vars", message: "Var x unused", line: 1, column: 2, severity: 2 },
            { ruleId: "no-console", message: "Unexpected console", line: 5, column: 1, severity: 1 },
          ],
        },
        {
          filePath: "/repo/src/beta.ts",
          messages: [
            {
              ruleId: "eqeqeq",
              message: "Use === instead",
              line: 10,
              column: 3,
              severity: 2,
              fix: { range: [0, 1], text: "===" },
            },
          ],
        },
      ]),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(2);
    const alphaTask = tasks.find((t) => t.title.includes("alpha.ts"));
    const betaTask = tasks.find((t) => t.title.includes("beta.ts"));
    expect(alphaTask?.metadata.issueCount).toBe(2);
    expect(betaTask?.metadata.fixableCount).toBe(1);
    expect(betaTask?.complexity).toBe("trivial");
  });

  it("detects biome from biome.jsonc config file", async () => {
    mockExistingFiles(["biome.jsonc"]);
    queueSpawnResult({ stdout: "{}", exitCode: 0 });
    const scanner = new LintScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("biome");
  });

  it("handles biome diagnostics with path as a direct string in location", async () => {
    mockPackageJson({ scripts: { lint: "biome check ." } });
    queueSpawnResult({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: "lint/rule",
            description: "Problem found",
            severity: "error",
            location: {
              path: "src/direct-path.ts",
              span: { start: { line: 1, column: 0 } },
            },
          },
        ],
      }),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/direct-path.ts"]);
  });

  it("normalizes biome severity strings to numeric values", async () => {
    mockPackageJson({ scripts: { lint: "biome check ." } });
    queueSpawnResult({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: "lint/a",
            description: "Error",
            severity: "error",
            location: {
              path: { file: "src/a.ts" },
              span: { start: { line: 1, column: 1 } },
            },
          },
          {
            category: "lint/b",
            description: "Warning",
            severity: "warning",
            location: {
              path: { file: "src/a.ts" },
              span: { start: { line: 2, column: 1 } },
            },
          },
        ],
      }),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    const findings = (tasks[0]?.metadata as Record<string, unknown>).findings as Array<
      Record<string, unknown>
    >;
    expect(findings[0]?.severity).toBe(2);
    expect(findings[1]?.severity).toBe(1);
  });

  it("marks biome findings as fixable when suggestedFixes exists", async () => {
    mockPackageJson({ scripts: { lint: "biome check ." } });
    queueSpawnResult({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: "lint/rule",
            description: "Fixable issue",
            severity: "error",
            suggestedFixes: [{ description: "remove it" }],
            location: {
              path: { file: "src/a.ts" },
              span: { start: { line: 1, column: 0 } },
            },
          },
        ],
      }),
      exitCode: 1,
    });
    const scanner = new LintScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect((tasks[0]?.metadata as Record<string, unknown>).fixableCount).toBe(1);
  });
});
