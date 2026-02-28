import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir } from "node:fs/promises";
import { simpleGit } from "simple-git";
import { OacError } from "../../src/core/index.js";
import { createSandbox } from "../../src/execution/sandbox.js";

function createMockGit() {
  const rawCalls: string[][] = [];
  const mockGit = {
    raw: vi.fn(async (args: string[]) => {
      rawCalls.push(args);
      return "";
    }),
    _rawCalls: rawCalls,
  };
  return mockGit;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSandbox", () => {
  it("creates worktree with correct git commands", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/repo/path", "oac/test-branch", "main");

    expect(simpleGit).toHaveBeenCalledWith("/repo/path");
    expect(mkdir).toHaveBeenCalledWith(resolve(join("/repo/path", "..", ".oac-worktrees")), {
      recursive: true,
    });

    const expectedPath = resolve(join("/repo/path", "..", ".oac-worktrees", "oac/test-branch"));
    expect(mockGit.raw).toHaveBeenCalledWith([
      "worktree",
      "add",
      expectedPath,
      "-b",
      "oac/test-branch",
      "origin/main",
    ]);
    expect(sandbox.path).toBe(expectedPath);
    expect(sandbox.branchName).toBe("oac/test-branch");
  });

  it("rejects invalid branch names", async () => {
    await expect(createSandbox("/repo", "branch with spaces", "main")).rejects.toThrow(OacError);
    await expect(createSandbox("/repo", "branch;rm -rf", "main")).rejects.toThrow(OacError);
    await expect(createSandbox("/repo", "branch$(cmd)", "main")).rejects.toThrow(OacError);
  });

  it("rejects invalid base branch names", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    await expect(createSandbox("/repo", "valid-branch", "base branch")).rejects.toThrow(OacError);
    await expect(createSandbox("/repo", "valid-branch", "base;inject")).rejects.toThrow(OacError);
  });

  it("accepts valid branch name characters", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/repo", "oac/20260228/feature-a1.0", "main");
    expect(sandbox.branchName).toBe("oac/20260228/feature-a1.0");
  });

  it("cleanup removes worktree and prunes", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/repo/path", "oac/cleanup-test", "main");
    const expectedPath = resolve(join("/repo/path", "..", ".oac-worktrees", "oac/cleanup-test"));

    await sandbox.cleanup();

    expect(mockGit.raw).toHaveBeenCalledWith(["worktree", "remove", expectedPath, "--force"]);
    expect(mockGit.raw).toHaveBeenCalledWith(["worktree", "prune"]);
  });

  it("cleanup is idempotent", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/repo", "oac/idempotent", "main");

    await sandbox.cleanup();
    const callCountAfterFirst = mockGit.raw.mock.calls.length;

    await sandbox.cleanup();
    // No additional calls after second cleanup
    expect(mockGit.raw.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("cleanup still prunes even if worktree remove fails", async () => {
    const mockGit = createMockGit();
    const callLog: string[] = [];
    mockGit.raw.mockImplementation(async (args: string[]) => {
      callLog.push(`${args[0]}:${args[1]}`);
      if (args[0] === "worktree" && args[1] === "remove") {
        throw new Error("worktree remove failed");
      }
      return "";
    });
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/repo", "oac/prune-test", "main");
    expect(callLog).toEqual(["worktree:add"]);

    // cleanup should reject because remove fails
    let caught: Error | undefined;
    try {
      await sandbox.cleanup();
    } catch (e) {
      caught = e as Error;
    }

    expect(callLog).toContain("worktree:remove");
    expect(caught?.message).toBe("worktree remove failed");
    expect(callLog).toContain("worktree:prune");
  });
});

describe("getWorktreePath (tested via createSandbox)", () => {
  it("computes path relative to repo parent/.oac-worktrees", async () => {
    const mockGit = createMockGit();
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);

    const sandbox = await createSandbox("/home/user/project", "oac/my-branch", "main");
    const expected = resolve(join("/home/user/project", "..", ".oac-worktrees", "oac/my-branch"));
    expect(sandbox.path).toBe(expected);
  });
});
