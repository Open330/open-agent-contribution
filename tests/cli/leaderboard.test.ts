import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import type { ContributionLog } from "../../src/tracking/index.js";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLeaderboardCommand } from "../../src/cli/commands/leaderboard.js";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

const mockedReaddir = vi.mocked(readdir);
const mockedReadFile = vi.mocked(readFile);

interface LeaderboardEntry {
  githubUsername: string;
  totalRuns: number;
  totalTasksCompleted: number;
  totalTokensDonated: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
}

interface LeaderboardJsonPayload {
  total: number;
  sort: "runs" | "tasks" | "tokens" | "prs";
  entries: LeaderboardEntry[];
}

function createRootProgram(): Command {
  const root = new Command()
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  root.addCommand(createLeaderboardCommand());
  return root;
}

function createDirent(name: string): Dirent {
  return {
    name,
    isFile: () => true,
  } as unknown as Dirent;
}

function createErrno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function makeContributionLog(input: {
  runId: string;
  timestamp: string;
  username: string;
  source: "lint" | "todo";
  tokensUsed: number;
  prStatus?: "open" | "merged" | "closed";
}): ContributionLog {
  return {
    version: "1.0",
    runId: input.runId,
    timestamp: input.timestamp,
    contributor: {
      githubUsername: input.username,
      email: `${input.username}@example.com`,
    },
    repo: {
      fullName: "owner/repo",
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
        title: "Task",
        source: input.source,
        complexity: "simple",
        status: "success",
        tokensUsed: 100,
        duration: 10,
        filesChanged: ["src/file.ts"],
        pr: input.prStatus
          ? {
              number: 11,
              url: "https://github.com/owner/repo/pull/11",
              status: input.prStatus,
            }
          : undefined,
      },
    ],
    metrics: {
      tasksDiscovered: 3,
      tasksAttempted: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      totalDuration: 10,
      totalFilesChanged: 1,
      totalLinesAdded: 3,
      totalLinesRemoved: 1,
    },
  };
}

async function runLeaderboardJson(args: string[] = []): Promise<LeaderboardJsonPayload> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "--json", "leaderboard", ...args]);

  const output = logSpy.mock.calls.at(-1)?.[0];
  if (typeof output !== "string") {
    throw new Error("Expected JSON output from leaderboard command.");
  }

  return JSON.parse(output) as LeaderboardJsonPayload;
}

async function runLeaderboardTable(args: string[] = []): Promise<string> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "leaderboard", ...args]);

  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedReadFile.mockReset();
  mockedReaddir.mockReset();
});

describe("createLeaderboardCommand", () => {
  it("returns a Commander Command instance", () => {
    const command = createLeaderboardCommand();
    expect(command.name()).toBe("leaderboard");
  });

  it("handles empty data when leaderboard and contributions are missing", async () => {
    mockedReadFile.mockRejectedValueOnce(createErrno("ENOENT"));
    mockedReaddir.mockRejectedValue(createErrno("ENOENT"));

    const payload = await runLeaderboardJson();

    expect(payload.total).toBe(0);
    expect(payload.entries).toEqual([]);
  });

  it("parses and displays entries from .oac/leaderboard.json", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({
        entries: [
          {
            githubUsername: "alice",
            totalRuns: 3,
            totalTasksCompleted: 9,
            totalTokensDonated: 1200,
            totalPRsCreated: 3,
            totalPRsMerged: 2,
          },
        ],
      }),
    );

    const output = await runLeaderboardTable();

    expect(output).toContain("Rank");
    expect(output).toContain("alice");
    expect(output).toContain("1,200");
  });

  it("respects --limit option", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({
        entries: [
          {
            githubUsername: "alice",
            totalRuns: 3,
            totalTasksCompleted: 9,
            totalTokensDonated: 1200,
            totalPRsCreated: 3,
            totalPRsMerged: 2,
          },
          {
            githubUsername: "bob",
            totalRuns: 2,
            totalTasksCompleted: 7,
            totalTokensDonated: 800,
            totalPRsCreated: 1,
            totalPRsMerged: 1,
          },
        ],
      }),
    );

    const payload = await runLeaderboardJson(["--limit", "1"]);

    expect(payload.total).toBe(1);
    expect(payload.entries[0]?.githubUsername).toBe("alice");
  });

  it("respects --sort option", async () => {
    mockedReadFile.mockResolvedValue(
      JSON.stringify({
        entries: [
          {
            githubUsername: "alice",
            totalRuns: 2,
            totalTasksCompleted: 3,
            totalTokensDonated: 300,
            totalPRsCreated: 1,
            totalPRsMerged: 1,
          },
          {
            githubUsername: "bob",
            totalRuns: 1,
            totalTasksCompleted: 2,
            totalTokensDonated: 900,
            totalPRsCreated: 1,
            totalPRsMerged: 1,
          },
        ],
      }),
    );

    const payload = await runLeaderboardJson(["--sort", "tokens"]);

    expect(payload.sort).toBe("tokens");
    expect(payload.entries[0]?.githubUsername).toBe("bob");
  });

  it("computes leaderboard from contribution logs when leaderboard file is missing", async () => {
    const aliceLog = makeContributionLog({
      runId: "run-a",
      timestamp: "2026-02-10T10:00:00+00:00",
      username: "alice",
      source: "lint",
      tokensUsed: 500,
      prStatus: "merged",
    });
    const bobLog = makeContributionLog({
      runId: "run-b",
      timestamp: "2026-02-11T10:00:00+00:00",
      username: "bob",
      source: "todo",
      tokensUsed: 100,
      prStatus: "open",
    });

    mockedReadFile.mockImplementation(async (path) => {
      const filePath = String(path);
      if (filePath.endsWith("leaderboard.json")) {
        throw createErrno("ENOENT");
      }
      if (filePath.endsWith("a.json")) {
        return JSON.stringify(aliceLog);
      }
      if (filePath.endsWith("b.json")) {
        return JSON.stringify(bobLog);
      }
      throw new Error(`Unexpected read path: ${filePath}`);
    });
    mockedReaddir.mockResolvedValue([
      createDirent("a.json"),
      createDirent("b.json"),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    const payload = await runLeaderboardJson();

    expect(payload.total).toBe(2);
    expect(payload.entries[0]?.githubUsername).toBe("alice");
    expect(payload.entries[0]?.totalPRsMerged).toBe(1);
  });
});
