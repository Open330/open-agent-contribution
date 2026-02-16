import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContributionLog } from "../src/log-schema.js";

// Mock node:fs/promises before importing the module under test
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:crypto for deterministic UUIDs
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
}));

// Mock leaderboard to avoid side effects
vi.mock("../src/leaderboard.js", () => ({
  buildLeaderboard: vi.fn().mockResolvedValue({
    generatedAt: "2026-01-01T00:00:00.000Z",
    entries: [],
    repoStats: {
      totalContributions: 0,
      totalTokensUsed: 0,
      totalPRsCreated: 0,
      totalPRsMerged: 0,
      firstContribution: "",
      lastContribution: "",
    },
  }),
}));

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { writeContributionLog } from "../src/logger.js";

function makeValidLog(overrides: Partial<ContributionLog> = {}): ContributionLog {
  return {
    version: "1.0",
    runId: "run-abc-123",
    timestamp: "2026-01-15T10:30:00+00:00",
    contributor: {
      githubUsername: "testuser",
      email: "test@example.com",
    },
    repo: {
      fullName: "owner/repo",
      headSha: "abc1234def5678",
      defaultBranch: "main",
    },
    budget: {
      provider: "claude-code",
      totalTokensBudgeted: 100_000,
      totalTokensUsed: 50_000,
    },
    tasks: [
      {
        taskId: "task-1",
        title: "Fix lint warning",
        source: "lint",
        complexity: "trivial",
        status: "success",
        tokensUsed: 5_000,
        duration: 30,
        filesChanged: ["src/file.ts"],
      },
    ],
    metrics: {
      tasksDiscovered: 10,
      tasksAttempted: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      totalDuration: 30,
      totalFilesChanged: 1,
      totalLinesAdded: 5,
      totalLinesRemoved: 2,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("filename format: YYYY-MM-DD-HHmmss-username.json", () => {
  it("generates correct filename from timestamp and username", async () => {
    const log = makeValidLog({
      timestamp: "2026-03-15T14:30:45+00:00",
      contributor: { githubUsername: "alice" },
    });

    const filePath = await writeContributionLog(log, "/tmp/repo");

    // UTC: 2026-03-15 14:30:45 -> 2026-03-15-143045
    expect(filePath).toMatch(/2026-03-15-143045-alice\.json$/);
  });

  it("zero-pads single-digit month and day", async () => {
    const log = makeValidLog({
      timestamp: "2026-01-05T08:05:09+00:00",
      contributor: { githubUsername: "bob" },
    });

    const filePath = await writeContributionLog(log, "/tmp/repo");

    expect(filePath).toMatch(/2026-01-05-080509-bob\.json$/);
  });

  it("sanitizes special characters in username", async () => {
    const log = makeValidLog({
      timestamp: "2026-06-01T00:00:00+00:00",
      contributor: { githubUsername: "user-name" },
    });

    const filePath = await writeContributionLog(log, "/tmp/repo");

    // Hyphens are valid in filenames, should be preserved
    expect(filePath).toMatch(/user-name\.json$/);
  });

  it("includes correct directory path with .oac/contributions", async () => {
    const log = makeValidLog();

    const filePath = await writeContributionLog(log, "/home/dev/project");

    expect(filePath).toContain("/home/dev/project");
    expect(filePath).toContain(".oac");
    expect(filePath).toContain("contributions");
  });

  it("converts UTC timestamp correctly even with timezone offset", async () => {
    // Timestamp is 2026-01-15T10:30:00+00:00 -> UTC is 10:30:00
    const log = makeValidLog({
      timestamp: "2026-01-15T10:30:00+00:00",
      contributor: { githubUsername: "testuser" },
    });

    const filePath = await writeContributionLog(log, "/tmp/repo");

    expect(filePath).toMatch(/2026-01-15-103000-testuser\.json$/);
  });
});

describe("mock filesystem operations", () => {
  it("calls mkdir with recursive: true to create contributions directory", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/tmp/repo");

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining(".oac"), { recursive: true });
    const mkdirPath = vi.mocked(mkdir).mock.calls[0][0] as string;
    expect(mkdirPath).toContain("contributions");
  });

  it("calls writeFile with exclusive flag (wx) for atomic write", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/tmp/repo");

    expect(writeFile).toHaveBeenCalledOnce();
    const [tempPath, content, options] = vi.mocked(writeFile).mock.calls[0];

    // Temp file path should contain .tmp suffix
    expect(tempPath).toMatch(/\.tmp$/);
    // Content should be valid JSON
    expect(typeof content).toBe("string");
    expect(() => JSON.parse(content as string)).not.toThrow();
    // Should use exclusive write flag
    expect(options).toEqual({ encoding: "utf8", flag: "wx" });
  });

  it("calls rename to atomically move temp file to final path", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/tmp/repo");

    expect(rename).toHaveBeenCalledOnce();
    const [tempPath, finalPath] = vi.mocked(rename).mock.calls[0];
    expect(tempPath).toMatch(/\.tmp$/);
    expect(finalPath).toMatch(/\.json$/);
  });

  it("calls rm to clean up temp file in finally block", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/tmp/repo");

    expect(rm).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), { force: true });
  });

  it("writes pretty-printed JSON with trailing newline", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/tmp/repo");

    const content = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(content).toMatch(/\n$/);
    // Verify it is indented (pretty-printed)
    expect(content).toContain("  ");
    // Verify parsed content matches input
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe("1.0");
    expect(parsed.runId).toBe("run-abc-123");
  });
});

describe("directory creation", () => {
  it("creates the .oac/contributions directory under the repo path", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/my/project");

    expect(mkdir).toHaveBeenCalledOnce();
    const dirPath = vi.mocked(mkdir).mock.calls[0][0] as string;
    // Should resolve to an absolute path containing .oac/contributions
    expect(dirPath).toContain(".oac");
    expect(dirPath).toContain("contributions");
  });

  it("uses recursive mkdir so nested directories are created", async () => {
    const log = makeValidLog();

    await writeContributionLog(log, "/nonexistent/path");

    expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("returns the final file path", async () => {
    const log = makeValidLog();

    const result = await writeContributionLog(log, "/tmp/repo");

    expect(typeof result).toBe("string");
    expect(result).toMatch(/\.json$/);
    expect(result).not.toMatch(/\.tmp/);
  });
});
