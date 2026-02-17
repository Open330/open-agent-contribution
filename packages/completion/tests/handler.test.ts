import type { Octokit } from "@octokit/rest";
import {
  type ExecutionResult,
  type ResolvedRepo,
  type Task,
  createEventBus,
} from "@open330/oac-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/diff-validator.js", () => ({
  validateDiff: vi.fn().mockResolvedValue({ valid: true, warnings: [], errors: [] }),
}));

vi.mock("../src/github-pr.js", () => ({
  pushBranch: vi.fn().mockResolvedValue("abc123"),
  createPR: vi
    .fn()
    .mockResolvedValue({ url: "https://github.com/o/r/pull/1", number: 1, sha: "abc123" }),
}));

vi.mock("../src/issue-linker.js", () => ({
  linkIssueToePR: vi.fn().mockResolvedValue(undefined),
}));

import { validateDiff } from "../src/diff-validator.js";
import { createPR, pushBranch } from "../src/github-pr.js";
import { CompletionHandler, type CompletionHandlerParams } from "../src/handler.js";
import { linkIssueToePR } from "../src/issue-linker.js";
import type {
  CompletionResult,
  CreatedPR,
  ExternalTaskRef,
  ProjectManagementProvider,
} from "../src/types.js";

interface MockProvider extends ProjectManagementProvider {
  ping: ReturnType<typeof vi.fn>;
  notifyStarted: ReturnType<typeof vi.fn>;
  notifyPRCreated: ReturnType<typeof vi.fn>;
  notifyCompleted: ReturnType<typeof vi.fn>;
  notifyFailed: ReturnType<typeof vi.fn>;
}

function makeRepo(overrides: Partial<ResolvedRepo> = {}): ResolvedRepo {
  return {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    localPath: "/tmp/repo",
    worktreePath: "/tmp/repo-wt",
    meta: {
      defaultBranch: "main",
      languages: { TypeScript: 100 },
      size: 1000,
      stars: 10,
      openIssuesCount: 3,
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
    source: "lint",
    title: "Fix failing tests",
    description: "Repair flaky assertions",
    targetFiles: ["src/file.ts"],
    priority: 80,
    complexity: "simple",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    exitCode: 0,
    totalTokensUsed: 1234,
    filesChanged: ["src/file.ts", "src/util.ts"],
    duration: 42,
    ...overrides,
  };
}

function makeParams(overrides: Partial<CompletionHandlerParams> = {}): CompletionHandlerParams {
  return {
    jobId: "job-1",
    repo: makeRepo(),
    task: makeTask(),
    result: makeExecutionResult(),
    branchName: "oac/task-1",
    baseBranch: "main",
    ...overrides,
  };
}

function makeProvider(id = "github"): MockProvider {
  return {
    id,
    name: `${id} provider`,
    ping: vi.fn().mockResolvedValue(true),
    notifyStarted: vi.fn().mockResolvedValue(undefined),
    notifyPRCreated: vi.fn().mockResolvedValue(undefined),
    notifyCompleted: vi.fn().mockResolvedValue(undefined),
    notifyFailed: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateDiff).mockResolvedValue({ valid: true, warnings: [], errors: [] });
  vi.mocked(pushBranch).mockResolvedValue("abc123");
  vi.mocked(createPR).mockResolvedValue({
    url: "https://github.com/o/r/pull/1",
    number: 1,
    sha: "abc123",
  } satisfies CreatedPR);
  vi.mocked(linkIssueToePR).mockResolvedValue(undefined);
});

describe("CompletionHandler", () => {
  it("handle() calls complete() internally", async () => {
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
    });
    const params = makeParams();
    const expected: CompletionResult = {
      prUrl: "https://github.com/o/r/pull/9",
      commitSha: "sha9",
      summary: "Done",
      filesChanged: 2,
      tokensUsed: 90,
    };
    const completeSpy = vi.spyOn(handler, "complete").mockResolvedValue(expected);

    const result = await handler.handle(params);

    expect(completeSpy).toHaveBeenCalledOnce();
    expect(completeSpy).toHaveBeenCalledWith(params);
    expect(result).toEqual(expected);
  });

  it("returns CompletionResult with prUrl and summary on success", async () => {
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
    });
    const params = makeParams({
      task: makeTask({ title: "Fix failing tests" }),
      result: makeExecutionResult({
        filesChanged: ["src/a.ts", "src/b.ts", "src/c.ts"],
        totalTokensUsed: 4321,
      }),
    });

    const result = await handler.complete(params);

    expect(result.prUrl).toBe("https://github.com/o/r/pull/1");
    expect(result.commitSha).toBe("abc123");
    expect(result.summary).toBe('Created PR #1 for "Fix failing tests".');
    expect(result.filesChanged).toBe(3);
    expect(result.tokensUsed).toBe(4321);
  });

  it("emits pr:created when a PR is created", async () => {
    const eventBus = createEventBus();
    const listener = vi.fn();
    eventBus.on("pr:created", listener);
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus,
    });
    const params = makeParams();

    await handler.complete(params);

    expect(listener).toHaveBeenCalledWith({
      jobId: "job-1",
      prUrl: "https://github.com/o/r/pull/1",
    });
  });

  it("emits execution:progress for each completion stage", async () => {
    const eventBus = createEventBus();
    const progressEvents: Array<{ stage: string; tokensUsed: number }> = [];
    eventBus.on("execution:progress", (payload) => {
      progressEvents.push({
        stage: payload.stage,
        tokensUsed: payload.tokensUsed,
      });
    });

    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus,
    });
    const params = makeParams({
      result: makeExecutionResult({ totalTokensUsed: 987 }),
    });

    await handler.complete(params);

    expect(progressEvents.map((event) => event.stage)).toEqual([
      "completion:validateDiff",
      "completion:pushBranch",
      "completion:createPR",
      "completion:linkIssue",
      "completion:notifyWebhooks",
    ]);
    expect(progressEvents.every((event) => event.tokensUsed === 987)).toBe(true);
  });

  it("throws VALIDATION_DIFF_TOO_LARGE when diff validation fails on size", async () => {
    vi.mocked(validateDiff).mockResolvedValue({
      valid: false,
      warnings: [],
      errors: ["Diff too large: 900 changed lines exceeds maxDiffLines=500."],
    });

    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
    });

    await expect(handler.complete(makeParams())).rejects.toMatchObject({
      code: "VALIDATION_DIFF_TOO_LARGE",
    });
    expect(pushBranch).not.toHaveBeenCalled();
  });

  it("throws VALIDATION_FORBIDDEN_PATTERN when forbidden pattern is detected", async () => {
    vi.mocked(validateDiff).mockResolvedValue({
      valid: false,
      warnings: [],
      errors: ['Forbidden pattern "/eval/" found in src/a.ts: "eval(x)".'],
    });

    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
    });

    await expect(handler.complete(makeParams())).rejects.toMatchObject({
      code: "VALIDATION_FORBIDDEN_PATTERN",
    });
    expect(pushBranch).not.toHaveBeenCalled();
  });

  it("adds an issue-linking warning and still succeeds when linking fails", async () => {
    vi.mocked(linkIssueToePR).mockRejectedValue(new Error("link failed"));
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
    });

    const result = await handler.complete(makeParams());

    expect(result.prUrl).toBe("https://github.com/o/r/pull/1");
    expect(result.summary).toContain("Completed with 1 warning(s).");
  });

  it("resolves external task ref from task.linkedIssue", async () => {
    const provider = makeProvider("github");
    const task = makeTask({
      linkedIssue: {
        number: 77,
        url: "https://github.com/owner/repo/issues/77",
        labels: ["bug"],
      },
    });
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
      providers: [provider],
    });
    const params = makeParams({ task });
    const expectedRef: ExternalTaskRef = {
      provider: "github",
      externalId: "#77",
      url: "https://github.com/owner/repo/issues/77",
    };

    await handler.complete(params);

    expect(provider.notifyStarted).toHaveBeenCalledWith(expectedRef);
    expect(provider.notifyPRCreated).toHaveBeenCalledWith(
      expectedRef,
      "https://github.com/o/r/pull/1",
    );
    expect(provider.notifyCompleted).toHaveBeenCalledWith(
      expectedRef,
      expect.objectContaining({
        prUrl: "https://github.com/o/r/pull/1",
      }),
    );
  });

  it("resolves external task ref from task metadata when linkedIssue is absent", async () => {
    const provider = makeProvider("linear");
    const task = makeTask({
      linkedIssue: undefined,
      metadata: {
        externalProvider: "linear",
        externalId: "ENG-42",
        externalUrl: "https://linear.app/team/issue/ENG-42",
      },
    });
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
      providers: [provider],
    });
    const params = makeParams({ task });
    const expectedRef: ExternalTaskRef = {
      provider: "linear",
      externalId: "ENG-42",
      url: "https://linear.app/team/issue/ENG-42",
    };

    await handler.complete(params);

    expect(provider.notifyStarted).toHaveBeenCalledWith(expectedRef);
  });

  it("notifies providers on successful completion", async () => {
    const provider = makeProvider("linear");
    const externalTaskRef: ExternalTaskRef = {
      provider: "linear",
      externalId: "ENG-99",
      url: "https://linear.app/team/issue/ENG-99",
    };
    const handler = new CompletionHandler({
      octokit: {} as Octokit,
      eventBus: createEventBus(),
      providers: [provider],
    });
    const params = makeParams({ externalTaskRef });

    await handler.complete(params);

    expect(provider.ping).toHaveBeenCalledTimes(3);
    expect(provider.notifyStarted).toHaveBeenCalledOnce();
    expect(provider.notifyPRCreated).toHaveBeenCalledOnce();
    expect(provider.notifyCompleted).toHaveBeenCalledOnce();
    expect(provider.notifyFailed).not.toHaveBeenCalled();
  });
});
