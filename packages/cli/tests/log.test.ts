import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import type { ContributionLog } from "@oac/tracking";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLogCommand } from "../src/commands/log.js";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

const mockedReaddir = vi.mocked(readdir);
const mockedReadFile = vi.mocked(readFile);

interface LogJsonPayload {
  total: number;
  entries: ContributionLog[];
}

function createRootProgram(): Command {
  const root = new Command()
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  root.addCommand(createLogCommand());
  return root;
}

function createDirent(name: string): Dirent {
  return {
    name,
    isFile: () => true,
  } as unknown as Dirent;
}

function makeContributionLog(input: {
  runId: string;
  timestamp: string;
  repoFullName: string;
  source: "lint" | "todo" | "test-gap";
  tokensUsed: number;
}): ContributionLog {
  return {
    version: "1.0",
    runId: input.runId,
    timestamp: input.timestamp,
    contributor: {
      githubUsername: "octocat",
      email: "octocat@example.com",
    },
    repo: {
      fullName: input.repoFullName,
      headSha: "abcdef1",
      defaultBranch: "main",
    },
    budget: {
      provider: "claude-code",
      totalTokensBudgeted: 100_000,
      totalTokensUsed: input.tokensUsed,
    },
    tasks: [
      {
        taskId: "task-1",
        title: "Fix issue",
        source: input.source,
        complexity: "simple",
        status: "success",
        tokensUsed: 500,
        duration: 30,
        filesChanged: ["src/a.ts"],
        pr: {
          number: 1,
          url: "https://github.com/owner/repo/pull/1",
          status: "merged",
        },
      },
    ],
    metrics: {
      tasksDiscovered: 2,
      tasksAttempted: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      totalDuration: 30,
      totalFilesChanged: 1,
      totalLinesAdded: 10,
      totalLinesRemoved: 2,
    },
  };
}

function createErrno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function runLogJson(args: string[] = []): Promise<LogJsonPayload> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "--json", "log", ...args]);

  const output = logSpy.mock.calls.at(-1)?.[0];
  if (typeof output !== "string") {
    throw new Error("Expected JSON output from log command.");
  }

  return JSON.parse(output) as LogJsonPayload;
}

async function runLogTable(args: string[] = []): Promise<string> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "log", ...args]);

  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedReaddir.mockReset();
  mockedReadFile.mockReset();
});

describe("createLogCommand", () => {
  it("returns a Commander Command instance", () => {
    const command = createLogCommand();
    expect(command.name()).toBe("log");
  });

  it("handles missing contributions directory", async () => {
    mockedReaddir.mockRejectedValue(createErrno("ENOENT"));

    const payload = await runLogJson();

    expect(payload.total).toBe(0);
    expect(payload.entries).toEqual([]);
  });

  it("parses and displays entries correctly", async () => {
    const log = makeContributionLog({
      runId: "run-1",
      timestamp: "2026-02-15T10:00:00+00:00",
      repoFullName: "owner/repo",
      source: "lint",
      tokensUsed: 12_345,
    });

    mockedReaddir.mockResolvedValue([createDirent("one.json")] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    mockedReadFile.mockResolvedValue(JSON.stringify(log));

    const output = await runLogTable();

    expect(output).toContain("Date");
    expect(output).toContain("owner/repo");
    expect(output).toContain("12,345");
    expect(output).toContain("lint");
  });

  it("respects --limit option", async () => {
    const older = makeContributionLog({
      runId: "run-older",
      timestamp: "2026-02-01T10:00:00+00:00",
      repoFullName: "owner/repo",
      source: "lint",
      tokensUsed: 111,
    });
    const newer = makeContributionLog({
      runId: "run-newer",
      timestamp: "2026-02-10T10:00:00+00:00",
      repoFullName: "owner/repo",
      source: "todo",
      tokensUsed: 222,
    });

    mockedReaddir.mockResolvedValue([
      createDirent("older.json"),
      createDirent("newer.json"),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockedReadFile.mockImplementation(async (path) => {
      const filePath = String(path);
      if (filePath.endsWith("older.json")) {
        return JSON.stringify(older);
      }
      if (filePath.endsWith("newer.json")) {
        return JSON.stringify(newer);
      }
      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const payload = await runLogJson(["--limit", "1"]);

    expect(payload.total).toBe(1);
    expect(payload.entries[0]?.runId).toBe("run-newer");
  });

  it("respects --repo option", async () => {
    const repoA = makeContributionLog({
      runId: "run-a",
      timestamp: "2026-02-10T10:00:00+00:00",
      repoFullName: "owner/repo-a",
      source: "lint",
      tokensUsed: 100,
    });
    const repoB = makeContributionLog({
      runId: "run-b",
      timestamp: "2026-02-11T10:00:00+00:00",
      repoFullName: "owner/repo-b",
      source: "todo",
      tokensUsed: 200,
    });

    mockedReaddir.mockResolvedValue([
      createDirent("a.json"),
      createDirent("b.json"),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockedReadFile.mockImplementation(async (path) => {
      const filePath = String(path);
      if (filePath.endsWith("a.json")) {
        return JSON.stringify(repoA);
      }
      if (filePath.endsWith("b.json")) {
        return JSON.stringify(repoB);
      }
      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const payload = await runLogJson(["--repo", "owner/repo-b"]);

    expect(payload.total).toBe(1);
    expect(payload.entries[0]?.repo.fullName).toBe("owner/repo-b");
  });

  it("respects --source and --since options", async () => {
    const olderLint = makeContributionLog({
      runId: "run-old-lint",
      timestamp: "2026-01-10T10:00:00+00:00",
      repoFullName: "owner/repo",
      source: "lint",
      tokensUsed: 100,
    });
    const newerTodo = makeContributionLog({
      runId: "run-new-todo",
      timestamp: "2026-02-12T10:00:00+00:00",
      repoFullName: "owner/repo",
      source: "todo",
      tokensUsed: 300,
    });

    mockedReaddir.mockResolvedValue([
      createDirent("x.json"),
      createDirent("y.json"),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockedReadFile.mockImplementation(async (path) => {
      const filePath = String(path);
      if (filePath.endsWith("x.json")) {
        return JSON.stringify(olderLint);
      }
      if (filePath.endsWith("y.json")) {
        return JSON.stringify(newerTodo);
      }
      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const payload = await runLogJson(["--source", "todo", "--since", "2026-02-01T00:00:00Z"]);

    expect(payload.total).toBe(1);
    expect(payload.entries[0]?.runId).toBe("run-new-todo");
  });
});
