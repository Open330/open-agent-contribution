import type { Octokit } from "@octokit/rest";
import type { ResolvedRepo, Task } from "@open330/oac-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { linkIssueToePR } from "../src/issue-linker.js";
import type { CreatedPR } from "../src/types.js";

const mockOctokit = {
  issues: {
    get: vi.fn(),
    createComment: vi.fn(),
  },
};

function makeRepo(overrides: Partial<ResolvedRepo> = {}): ResolvedRepo {
  return {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    localPath: "/tmp/repo",
    worktreePath: "/tmp/repo",
    meta: {
      defaultBranch: "main",
      languages: {},
      size: 0,
      stars: 0,
      openIssuesCount: 0,
      topics: [],
      isArchived: false,
      isFork: false,
      permissions: {
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      },
    },
    git: {
      headSha: "abc123",
      remoteUrl: "https://github.com/owner/repo.git",
      isShallowClone: false,
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    source: "github-issue",
    title: "Link issue to PR",
    description: "Create linkage comment",
    targetFiles: ["src/file.ts"],
    priority: 70,
    complexity: "simple",
    executionMode: "new-pr",
    linkedIssue: {
      number: 42,
      url: "https://github.com/owner/repo/issues/42",
      labels: ["bug"],
    },
    metadata: {},
    discoveredAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makePR(overrides: Partial<CreatedPR> = {}): CreatedPR {
  return {
    number: 10,
    url: "https://github.com/owner/repo/pull/10",
    sha: "abc123",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOctokit.issues.get.mockResolvedValue({ data: { state: "open" } });
  mockOctokit.issues.createComment.mockResolvedValue({});
});

describe("linkIssueToePR", () => {
  it("returns early when task has no linkedIssue", async () => {
    const repo = makeRepo();
    const task = makeTask({ linkedIssue: undefined });
    const pr = makePR();

    await linkIssueToePR(repo, task, pr, mockOctokit as unknown as Octokit);

    expect(mockOctokit.issues.get).not.toHaveBeenCalled();
    expect(mockOctokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("creates a comment when linked issue exists and is open", async () => {
    const repo = makeRepo();
    const task = makeTask();
    const pr = makePR();

    await linkIssueToePR(repo, task, pr, mockOctokit as unknown as Octokit);

    expect(mockOctokit.issues.get).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
    });
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: `OAC opened a PR for this issue: ${pr.url}`,
    });
  });

  it("returns without creating a comment when linked issue is closed", async () => {
    mockOctokit.issues.get.mockResolvedValue({ data: { state: "closed" } });
    const repo = makeRepo();
    const task = makeTask();
    const pr = makePR();

    await linkIssueToePR(repo, task, pr, mockOctokit as unknown as Octokit);

    expect(mockOctokit.issues.createComment).not.toHaveBeenCalled();
  });

  it.each([404, 410, 422])(
    "returns silently for non-blocking issue status %s",
    async (statusCode) => {
      mockOctokit.issues.get.mockRejectedValue({ status: statusCode });
      const repo = makeRepo();
      const task = makeTask();
      const pr = makePR();

      await expect(
        linkIssueToePR(repo, task, pr, mockOctokit as unknown as Octokit),
      ).resolves.toBeUndefined();

      expect(mockOctokit.issues.createComment).not.toHaveBeenCalled();
    },
  );

  it("throws completionError(PR_CREATION_FAILED) for other errors", async () => {
    mockOctokit.issues.get.mockRejectedValue({ status: 500 });
    const repo = makeRepo();
    const task = makeTask();
    const pr = makePR();

    await expect(
      linkIssueToePR(repo, task, pr, mockOctokit as unknown as Octokit),
    ).rejects.toMatchObject({
      code: "PR_CREATION_FAILED",
    });
  });
});
