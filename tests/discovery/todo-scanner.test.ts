import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("node:fs/promises", () => ({
  readFile: fsMocks.readFile,
  readdir: fsMocks.readdir,
}));

import { TodoScanner } from "../../src/discovery/scanners/todo-scanner.js";

const mockedSpawn = vi.mocked(spawn);
const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);
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

interface EntryDef {
  name: string;
  type: "file" | "dir";
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

function createDirent(name: string, type: "file" | "dir"): Dirent {
  return {
    name,
    isDirectory: () => type === "dir",
    isFile: () => type === "file",
  } as unknown as Dirent;
}

function setDirectoryEntries(entriesByAbsoluteDir: Record<string, EntryDef[]>): void {
  mockedReaddir.mockImplementation(async (path) => {
    const key = String(path);
    const entries = entriesByAbsoluteDir[key];
    if (!entries) {
      throw createErrno("ENOENT");
    }
    return entries.map((entry) => createDirent(entry.name, entry.type)) as Awaited<
      ReturnType<typeof readdir>
    >;
  });
}

function setFileContents(contentByAbsolutePath: Record<string, string | Error>): void {
  mockedReadFile.mockImplementation(async (path) => {
    const key = String(path);
    const content = contentByAbsolutePath[key];
    if (content === undefined) {
      throw createErrno("ENOENT");
    }
    if (content instanceof Error) {
      throw content;
    }
    return content;
  });
}

function makeRipgrepMatch(input: {
  filePath: string;
  line: number;
  text: string;
  keywordColumn?: number;
}): string {
  const fallbackColumn = Math.max(0, input.text.search(/\b(TODO|FIXME|HACK|XXX)\b/i));
  const start = input.keywordColumn !== undefined ? input.keywordColumn - 1 : fallbackColumn;

  return JSON.stringify({
    type: "match",
    data: {
      path: { text: input.filePath },
      lines: { text: `${input.text}\n` },
      line_number: input.line,
      submatches: [{ start }],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queuedSpawnResults = [];

  setDirectoryEntries({});
  setFileContents({});

  mockedSpawn.mockImplementation(() => {
    const next = queuedSpawnResults.shift() ?? {
      stdout: "",
      stderr: "",
      exitCode: 1,
      signal: null,
    };
    return createMockChildProcess(next) as unknown as ChildProcessWithoutNullStreams;
  });
});

describe("TodoScanner", () => {
  it("finds TODO comments via ripgrep", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/todo.ts",
        line: 2,
        text: "// TODO: improve parser",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/todo.ts")]:
        "export function parse() {\n  // TODO: improve parser\n}\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const [task] = tasks;
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
    const matches = (metadata.matches ?? []) as Array<Record<string, unknown>>;

    expect(tasks).toHaveLength(1);
    expect(task?.targetFiles).toEqual(["src/todo.ts"]);
    expect(metadata.matchCount).toBe(1);
    expect(matches[0]?.keyword).toBe("TODO");
  });

  it("falls back to file-system scanning when ripgrep is unavailable", async () => {
    queueSpawnResult({ emitError: createErrno("ENOENT") });
    setDirectoryEntries({
      [REPO_PATH]: [{ name: "src", type: "dir" }],
      [resolve(REPO_PATH, "src")]: [{ name: "fallback.ts", type: "file" }],
    });
    setFileContents({
      [resolve(REPO_PATH, "src/fallback.ts")]: "export const value = 1;\n// TODO: add validation\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedReaddir).toHaveBeenCalled();
  });

  it("groups nearby matches in the same file", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/grouped.ts", line: 5, text: "// TODO: first" }),
        makeRipgrepMatch({ filePath: "src/grouped.ts", line: 12, text: "// FIXME: second" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/grouped.ts")]: [
        "export function grouped() {",
        "  return 1;",
        "}",
        "",
        "// TODO: first",
        "const x = 1;",
        "const y = 2;",
        "",
        "",
        "",
        "",
        "// FIXME: second",
      ].join("\n"),
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const metadata = (tasks[0]?.metadata ?? {}) as Record<string, unknown>;

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.complexity).toBe("simple");
    expect(metadata.matchCount).toBe(2);
  });

  it("extracts nearest function context around TODO markers", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/context.ts",
        line: 4,
        text: "  // TODO: refine retry logic",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/context.ts")]: [
        "export async function processData(input: string) {",
        "  const value = input.trim();",
        "  // TODO: refine retry logic",
        "  return value;",
        "}",
      ].join("\n"),
    });
    const scanner = new TodoScanner();

    const [task] = await scanner.scan(REPO_PATH);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;

    expect(metadata.functionName).toBe("processData");
    expect(task?.description).toContain("processData");
  });

  it("assigns higher priority to FIXME than TODO", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/a.ts", line: 1, text: "// TODO: follow up" }),
        makeRipgrepMatch({ filePath: "src/b.ts", line: 1, text: "// FIXME: urgent bug" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "// TODO: follow up\n",
      [resolve(REPO_PATH, "src/b.ts")]: "// FIXME: urgent bug\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const priorities = new Map(tasks.map((task) => [task.targetFiles[0], task.priority]));

    // FIXME has a higher base weight (80) than TODO (50)
    expect(priorities.get("src/b.ts")).toBeGreaterThan(priorities.get("src/a.ts") ?? 0);
  });

  it("handles HACK and XXX keywords", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/hack.ts", line: 1, text: "// HACK: temporary branch" }),
        makeRipgrepMatch({ filePath: "src/xxx.ts", line: 1, text: "// XXX revisit ordering" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/hack.ts")]: "// HACK: temporary branch\n",
      [resolve(REPO_PATH, "src/xxx.ts")]: "// XXX revisit ordering\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const keywordSets = tasks.map(
      (task) => ((task.metadata as Record<string, unknown>).keywordSet ?? []) as string[],
    );

    expect(tasks).toHaveLength(2);
    expect(keywordSets).toEqual(expect.arrayContaining([["HACK"], ["XXX"]]));
  });

  it("respects exclude patterns", async () => {
    queueSpawnResult({ stdout: "", exitCode: 1 });
    const scanner = new TodoScanner();

    await scanner.scan(REPO_PATH, { exclude: ["tmp/**", "generated/*"] });

    const [command, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(command).toBe("rg");
    expect(args).toEqual(expect.arrayContaining(["--glob", "!tmp/**", "--glob", "!generated/*"]));
  });

  it("respects maxTasks limit", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/one.ts", line: 1, text: "// TODO: one" }),
        makeRipgrepMatch({ filePath: "src/two.ts", line: 1, text: "// TODO: two" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/one.ts")]: "// TODO: one\n",
      [resolve(REPO_PATH, "src/two.ts")]: "// TODO: two\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 1 });

    expect(tasks).toHaveLength(1);
  });

  it("handles empty repositories with no matches", async () => {
    queueSpawnResult({ stdout: "", exitCode: 1 });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("handles binary files gracefully in fs fallback mode", async () => {
    queueSpawnResult({ emitError: createErrno("ENOENT") });
    setDirectoryEntries({
      [REPO_PATH]: [
        { name: "bin.dat", type: "file" },
        { name: "src", type: "dir" },
      ],
      [resolve(REPO_PATH, "src")]: [{ name: "valid.ts", type: "file" }],
    });
    setFileContents({
      [resolve(REPO_PATH, "bin.dat")]: new Error("invalid utf8"),
      [resolve(REPO_PATH, "src/valid.ts")]: "// TODO: keep this task\n",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/valid.ts"]);
  });

  // ── Additional comprehensive tests ─────────────────────────

  it("has correct id and name", () => {
    const scanner = new TodoScanner();
    expect(scanner.id).toBe("todo");
    expect(scanner.name).toBe("TODO Scanner");
  });

  it("passes --hidden flag when includeHidden is true", async () => {
    queueSpawnResult({ stdout: "", exitCode: 1 });
    const scanner = new TodoScanner();

    await scanner.scan(REPO_PATH, { includeHidden: true });

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("--hidden");
  });

  it("does not pass --hidden by default", async () => {
    queueSpawnResult({ stdout: "", exitCode: 1 });
    const scanner = new TodoScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).not.toContain("--hidden");
  });

  it("always includes default excludes (.git, node_modules, dist, build, coverage)", async () => {
    queueSpawnResult({ stdout: "", exitCode: 1 });
    const scanner = new TodoScanner();

    await scanner.scan(REPO_PATH);

    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toContain("!.git");
    expect(args).toContain("!node_modules");
    expect(args).toContain("!dist");
    expect(args).toContain("!build");
    expect(args).toContain("!coverage");
  });

  it("throws when ripgrep exits with non-0/1 exit code", async () => {
    queueSpawnResult({ stdout: "", stderr: "rg: error", exitCode: 2 });
    const scanner = new TodoScanner();

    await expect(scanner.scan(REPO_PATH)).rejects.toThrow(/ripgrep failed/i);
  });

  it("skips non-match lines in ripgrep JSON output", async () => {
    const output = [
      JSON.stringify({ type: "begin", data: { path: { text: "src/a.ts" } } }),
      makeRipgrepMatch({ filePath: "src/a.ts", line: 3, text: "// TODO: real match" }),
      JSON.stringify({ type: "end", data: { path: { text: "src/a.ts" } } }),
    ].join("\n");
    queueSpawnResult({ stdout: output, exitCode: 0 });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "line1\nline2\n// TODO: real match\nline4",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
  });

  it("handles malformed JSON lines in ripgrep output", async () => {
    const output = [
      "not json at all",
      makeRipgrepMatch({ filePath: "src/a.ts", line: 1, text: "// TODO: valid" }),
      "{broken json",
    ].join("\n");
    queueSpawnResult({ stdout: output, exitCode: 0 });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "// TODO: valid",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
  });

  it("throws when ripgrep times out", async () => {
    queueSpawnResult({ stdout: "", exitCode: 0, closeDelayMs: 50 });
    const scanner = new TodoScanner();

    await expect(scanner.scan(REPO_PATH, { timeoutMs: 5 })).rejects.toThrow(/timed out/i);

    const child = mockedSpawn.mock.results[0]?.value as unknown as MockChildProcess;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("splits distant TODO lines into separate tasks", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/utils.ts", line: 1, text: "// TODO: first" }),
        makeRipgrepMatch({ filePath: "src/utils.ts", line: 50, text: "// TODO: second" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/utils.ts")]: Array.from({ length: 60 }, (_, i) => {
        if (i === 0) return "// TODO: first";
        if (i === 49) return "// TODO: second";
        return `line${i + 1}`;
      }).join("\n"),
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(2);
  });

  it("sets complexity to trivial for a single-line TODO", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({ filePath: "src/a.ts", line: 3, text: "// TODO: fix this" }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "line1\nline2\n// TODO: fix this\nline4",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks[0]?.complexity).toBe("trivial");
  });

  it("sets complexity to simple for a multi-line TODO comment", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 1,
        text: "// TODO: this spans multiple",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]:
        "// TODO: this spans multiple\n// continuation line\ncode here",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks[0]?.complexity).toBe("simple");
  });

  it("detects arrow function context", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 2,
        text: "  // TODO: handle edge case",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]:
        "const processItems = (items: string[]) => {\n  // TODO: handle edge case\n  return items;\n};",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect((tasks[0]?.metadata as Record<string, unknown>).functionName).toBe("processItems");
  });

  it("sets functionName to null when no function is found", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 1,
        text: "// TODO: top level comment",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "// TODO: top level comment\nconst x = 1;",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect((tasks[0]?.metadata as Record<string, unknown>).functionName).toBeNull();
  });

  it("detects Python def function pattern", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/main.py",
        line: 3,
        text: "    # TODO: optimize this",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/main.py")]:
        "import os\ndef process_data(data):\n    # TODO: optimize this\n    return data",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect((tasks[0]?.metadata as Record<string, unknown>).functionName).toBe("process_data");
  });

  it("has stable task ID for same content", async () => {
    const rgOutput = makeRipgrepMatch({
      filePath: "src/a.ts",
      line: 1,
      text: "// TODO: same content",
    });
    setFileContents({ [resolve(REPO_PATH, "src/a.ts")]: "// TODO: same content" });

    queueSpawnResult({ stdout: rgOutput, exitCode: 0 });
    const scanner = new TodoScanner();
    const tasks1 = await scanner.scan(REPO_PATH);

    queueSpawnResult({ stdout: rgOutput, exitCode: 0 });
    const tasks2 = await scanner.scan(REPO_PATH);

    expect(tasks1[0]?.id).toBe(tasks2[0]?.id);
    expect(tasks1[0]?.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("includes expected metadata fields", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 5,
        text: "// TODO: implement validation",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]:
        "line1\nline2\nline3\nline4\n// TODO: implement validation\nline6",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const task = tasks[0]!;
    const metadata = task.metadata as Record<string, unknown>;

    expect(metadata.scannerId).toBe("todo");
    expect(metadata.filePath).toBe("src/a.ts");
    expect(metadata.startLine).toBe(5);
    expect(metadata.endLine).toBe(5);
    expect(metadata.matchCount).toBe(1);
    expect(metadata.keywordSet).toEqual(["TODO"]);
    expect(task.executionMode).toBe("new-pr");
    expect(task.source).toBe("todo");
  });

  it("returns no tasks when maxTasks is 0", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({ filePath: "src/a.ts", line: 1, text: "// TODO: first" }),
      exitCode: 0,
    });
    setFileContents({ [resolve(REPO_PATH, "src/a.ts")]: "// TODO: first" });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 0 });

    expect(tasks).toEqual([]);
  });

  it("handles file read failure gracefully when building tasks", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/deleted.ts",
        line: 1,
        text: "// TODO: from deleted file",
      }),
      exitCode: 0,
    });
    // File is missing -- readFile returns ENOENT
    setFileContents({});
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    // Should still produce a task even if file can't be read for context
    expect(tasks).toHaveLength(1);
  });

  it("propagates non-ENOENT errors from ripgrep", async () => {
    queueSpawnResult({ emitError: createErrno("EACCES") });
    const scanner = new TodoScanner();

    await expect(scanner.scan(REPO_PATH)).rejects.toThrow("EACCES");
  });

  it("handles keyword extraction for case-insensitive matches", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 1,
        text: "// todo: lowercase keyword",
      }),
      exitCode: 0,
    });
    setFileContents({ [resolve(REPO_PATH, "src/a.ts")]: "// todo: lowercase keyword" });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect((tasks[0]?.metadata as Record<string, unknown>).keywordSet).toContain("TODO");
  });

  it("produces a description that includes the TODO summary", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 5,
        text: "// TODO: add error handling for edge cases",
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]:
        "line1\nline2\nline3\nline4\n// TODO: add error handling for edge cases",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks[0]?.description).toContain("Resolve TODO-style markers");
    expect(tasks[0]?.description).toContain("TODO at line 5");
  });

  it("excludes default directories in fs fallback", async () => {
    queueSpawnResult({ emitError: createErrno("ENOENT") });
    setDirectoryEntries({
      [REPO_PATH]: [
        { name: "src", type: "dir" },
        { name: "node_modules", type: "dir" },
        { name: ".git", type: "dir" },
        { name: "dist", type: "dir" },
      ],
      [resolve(REPO_PATH, "src")]: [{ name: "app.ts", type: "file" }],
    });
    setFileContents({
      [resolve(REPO_PATH, "src/app.ts")]: "// TODO: found this",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles[0]).toBe("src/app.ts");
  });

  it("groups matches from different files into separate tasks", async () => {
    queueSpawnResult({
      stdout: [
        makeRipgrepMatch({ filePath: "src/a.ts", line: 1, text: "// TODO: in a" }),
        makeRipgrepMatch({ filePath: "src/b.ts", line: 1, text: "// TODO: in b" }),
      ].join("\n"),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: "// TODO: in a",
      [resolve(REPO_PATH, "src/b.ts")]: "// TODO: in b",
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(2);
  });

  it("includes match details with line, column, keyword, and text", async () => {
    queueSpawnResult({
      stdout: makeRipgrepMatch({
        filePath: "src/a.ts",
        line: 10,
        text: "  // FIXME: broken logic here",
        keywordColumn: 6,
      }),
      exitCode: 0,
    });
    setFileContents({
      [resolve(REPO_PATH, "src/a.ts")]: Array.from({ length: 12 }, (_, i) => {
        if (i === 9) return "  // FIXME: broken logic here";
        return `line${i + 1}`;
      }).join("\n"),
    });
    const scanner = new TodoScanner();

    const tasks = await scanner.scan(REPO_PATH);
    const matches = (tasks[0]?.metadata as Record<string, unknown>).matches as Array<
      Record<string, unknown>
    >;

    expect(matches).toHaveLength(1);
    expect(matches[0]?.line).toBe(10);
    expect(matches[0]?.column).toBe(6);
    expect(matches[0]?.keyword).toBe("FIXME");
    expect(matches[0]?.text).toContain("FIXME");
  });
});
