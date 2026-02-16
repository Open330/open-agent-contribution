import { describe, expect, it, vi } from "vitest";

import { createEventBus } from "../src/event-bus.js";
import type { OacEventBus } from "../src/event-bus.js";

describe("createEventBus", () => {
  it("returns a typed EventEmitter instance", () => {
    const bus = createEventBus();
    expect(bus).toBeDefined();
    expect(typeof bus.on).toBe("function");
    expect(typeof bus.emit).toBe("function");
    expect(typeof bus.off).toBe("function");
    expect(typeof bus.removeAllListeners).toBe("function");
  });

  it("returns a new instance on every call", () => {
    const bus1 = createEventBus();
    const bus2 = createEventBus();
    expect(bus1).not.toBe(bus2);
  });
});

describe("emit and on for various event types", () => {
  let bus: OacEventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  it("delivers repo:resolved events", () => {
    const listener = vi.fn();
    bus.on("repo:resolved", listener);

    const payload = {
      repo: {
        fullName: "owner/repo",
        owner: "owner",
        name: "repo",
        localPath: "/tmp/repo",
        worktreePath: "/tmp/repo-wt",
        meta: {
          defaultBranch: "main",
          languages: { TypeScript: 100 },
          size: 1024,
          stars: 10,
          openIssuesCount: 5,
          topics: ["open-source"],
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
          headSha: "abc1234",
          remoteUrl: "https://github.com/owner/repo.git",
          isShallowClone: false,
        },
      },
    };

    bus.emit("repo:resolved", payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it("delivers task:discovered events with a tasks array", () => {
    const listener = vi.fn();
    bus.on("task:discovered", listener);

    const payload = {
      tasks: [
        {
          id: "task-1",
          source: "lint" as const,
          title: "Fix lint warning",
          description: "Unused import in file.ts",
          targetFiles: ["src/file.ts"],
          priority: 50,
          complexity: "trivial" as const,
          executionMode: "new-pr" as const,
          metadata: {},
          discoveredAt: "2026-01-01T00:00:00Z",
        },
      ],
    };

    bus.emit("task:discovered", payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].tasks).toHaveLength(1);
    expect(listener.mock.calls[0][0].tasks[0].id).toBe("task-1");
  });

  it("delivers execution:progress events", () => {
    const listener = vi.fn();
    bus.on("execution:progress", listener);

    const payload = { jobId: "job-42", tokensUsed: 5000, stage: "coding" };
    bus.emit("execution:progress", payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it("delivers pr:created events", () => {
    const listener = vi.fn();
    bus.on("pr:created", listener);

    const payload = { jobId: "job-7", prUrl: "https://github.com/o/r/pull/1" };
    bus.emit("pr:created", payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it("delivers run:completed events", () => {
    const listener = vi.fn();
    bus.on("run:completed", listener);

    const summary = {
      runId: "run-1",
      repo: "owner/repo",
      provider: "claude-code" as const,
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:05:00Z",
      duration: 300,
      budget: {
        totalTokens: 100_000,
        reserveTokens: 10_000,
        usedTokens: 50_000,
        remainingTokens: 40_000,
      },
      tasks: {
        discovered: 10,
        selected: 5,
        attempted: 5,
        succeeded: 4,
        failed: 1,
        deferred: 5,
      },
      pullRequests: {
        created: 4,
        merged: 2,
        urls: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
      },
    };

    bus.emit("run:completed", { summary });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].summary.runId).toBe("run-1");
  });
});

describe("multiple listeners", () => {
  it("invokes all registered listeners for the same event", () => {
    const bus = createEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    bus.on("execution:progress", listener1);
    bus.on("execution:progress", listener2);
    bus.on("execution:progress", listener3);

    const payload = { jobId: "j-1", tokensUsed: 100, stage: "init" };
    bus.emit("execution:progress", payload);

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
    expect(listener3).toHaveBeenCalledOnce();

    expect(listener1).toHaveBeenCalledWith(payload);
    expect(listener2).toHaveBeenCalledWith(payload);
    expect(listener3).toHaveBeenCalledWith(payload);
  });

  it("does not invoke listeners for unrelated events", () => {
    const bus = createEventBus();
    const prListener = vi.fn();
    const repoListener = vi.fn();

    bus.on("pr:created", prListener);
    bus.on("repo:resolved", repoListener);

    bus.emit("pr:created", {
      jobId: "j-1",
      prUrl: "https://github.com/o/r/pull/1",
    });

    expect(prListener).toHaveBeenCalledOnce();
    expect(repoListener).not.toHaveBeenCalled();
  });

  it("supports removing a specific listener with off", () => {
    const bus = createEventBus();
    const listener = vi.fn();

    bus.on("execution:progress", listener);
    bus.off("execution:progress", listener);

    bus.emit("execution:progress", {
      jobId: "j-1",
      tokensUsed: 100,
      stage: "init",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports once listeners that fire only once", () => {
    const bus = createEventBus();
    const listener = vi.fn();

    bus.once("pr:merged", listener);

    const payload = { jobId: "j-1", prUrl: "https://github.com/o/r/pull/1" };
    bus.emit("pr:merged", payload);
    bus.emit("pr:merged", payload);

    expect(listener).toHaveBeenCalledOnce();
  });
});
