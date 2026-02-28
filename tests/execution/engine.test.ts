import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("p-queue", () => {
  class MockPQueue {
    private readonly concurrency: number;
    private readonly pending: Array<() => void> = [];
    private readonly idleResolvers: Array<() => void> = [];
    private running = 0;
    private started: boolean;
    private paused = false;

    constructor(options: { concurrency?: number; autoStart?: boolean } = {}) {
      this.concurrency = options.concurrency ?? 1;
      this.started = options.autoStart ?? true;
    }

    add(task: () => Promise<void>, _options?: { priority?: number }): Promise<void> {
      return new Promise((resolve, reject) => {
        const run = async (): Promise<void> => {
          this.running += 1;
          try {
            await task();
            resolve();
          } catch (error) {
            reject(error);
          } finally {
            this.running -= 1;
            this.flush();
            this.resolveIdleIfNeeded();
          }
        };

        this.pending.push(() => {
          void run();
        });
        this.flush();
      });
    }

    start(): void {
      this.started = true;
      this.paused = false;
      this.flush();
    }

    pause(): void {
      this.paused = true;
    }

    clear(): void {
      this.pending.length = 0;
      this.resolveIdleIfNeeded();
    }

    onIdle(): Promise<void> {
      if (this.running === 0 && this.pending.length === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        this.idleResolvers.push(resolve);
      });
    }

    private flush(): void {
      if (!this.started || this.paused) {
        return;
      }

      while (this.running < this.concurrency && this.pending.length > 0) {
        const next = this.pending.shift();
        next?.();
      }
    }

    private resolveIdleIfNeeded(): void {
      if (this.running !== 0 || this.pending.length !== 0) {
        return;
      }

      const resolvers = this.idleResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  return { default: MockPQueue };
});

vi.mock("../../src/execution/sandbox.js", () => ({
  createSandbox: vi.fn(),
}));

vi.mock("../../src/execution/worker.js", () => ({
  executeTask: vi.fn(),
}));

import {
  type ExecutionPlan,
  type ExecutionResult,
  OacError,
  type Task,
  type TokenEstimate,
  createEventBus,
  executionError,
} from "../../src/core/index.js";
import type { AgentProvider } from "../../src/execution/agents/agent.interface.js";
import {
  CircuitBreaker,
  ExecutionEngine,
  calculateBackoff,
  isTransientError,
} from "../../src/execution/engine.js";
import { createSandbox } from "../../src/execution/sandbox.js";
import { executeTask } from "../../src/execution/worker.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    source: "lint",
    title: "Fix lint warning",
    description: "Fix one lint warning in the codebase.",
    targetFiles: ["src/file.ts"],
    priority: 50,
    complexity: "simple",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: "2026-02-16T00:00:00.000Z",
    ...overrides,
  };
}

function makeEstimate(taskId = "task-1", overrides: Partial<TokenEstimate> = {}): TokenEstimate {
  return {
    taskId,
    providerId: "claude-code",
    contextTokens: 2_000,
    promptTokens: 1_000,
    expectedOutputTokens: 2_000,
    totalEstimatedTokens: 5_000,
    confidence: 0.8,
    feasible: true,
    ...overrides,
  };
}

function makePlan(tasks: Task[] = [makeTask()]): ExecutionPlan {
  let cumulativeBudgetUsed = 0;
  const selectedTasks = tasks.map((task) => {
    const estimate = makeEstimate(task.id);
    cumulativeBudgetUsed += estimate.totalEstimatedTokens;
    return {
      task,
      estimate,
      cumulativeBudgetUsed,
    };
  });

  return {
    totalBudget: 50_000,
    selectedTasks,
    deferredTasks: [],
    reserveTokens: 5_000,
    remainingTokens: 40_000,
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    success: true,
    exitCode: 0,
    totalTokensUsed: 1_000,
    filesChanged: ["file.ts"],
    duration: 5_000,
    ...overrides,
  };
}

function makeSandboxContext() {
  return {
    path: "/tmp/sandbox",
    branchName: "oac/test",
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAgent(id = "test-agent"): AgentProvider {
  return {
    id,
    name: "Test Agent",
    checkAvailability: vi.fn().mockResolvedValue({ available: true, version: "1.0.0" }),
    execute: vi.fn().mockReturnValue({
      executionId: "execution-id",
      providerId: id,
      events: (async function* () {})(),
      result: Promise.resolve(
        makeExecutionResult({
          totalTokensUsed: 0,
          filesChanged: [],
          duration: 0,
        }),
      ),
    }),
    estimateTokens: vi.fn().mockResolvedValue(makeEstimate("task-1")),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSandbox).mockResolvedValue(makeSandboxContext());
  vi.mocked(executeTask).mockResolvedValue(makeExecutionResult());
});

describe("ExecutionEngine", () => {
  it("constructor throws if no agents provided", () => {
    const eventBus = createEventBus();

    let thrown: unknown;
    try {
      new ExecutionEngine([], eventBus);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OacError);
    expect((thrown as OacError).code).toBe("AGENT_NOT_AVAILABLE");
  });

  it("constructor accepts config with defaults", () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus(), {
      concurrency: 3,
      repoPath: "/tmp/repo-under-test",
    });

    const internal = engine as unknown as {
      concurrency: number;
      maxAttempts: number;
      repoPath: string;
      baseBranch: string;
      branchPrefix: string;
      taskTimeoutMs: number;
      defaultTokenBudget: number;
    };

    expect(internal.concurrency).toBe(3);
    expect(internal.maxAttempts).toBe(2);
    expect(internal.repoPath).toBe("/tmp/repo-under-test");
    expect(internal.baseBranch).toBe("main");
    expect(internal.branchPrefix).toBe("oac");
    expect(internal.taskTimeoutMs).toBe(300_000);
    expect(internal.defaultTokenBudget).toBe(50_000);
  });

  it("enqueue() creates jobs from execution plan", () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus());
    const plan = makePlan([makeTask({ id: "task-1" }), makeTask({ id: "task-2" })]);

    const jobs = engine.enqueue(plan);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].task.id).toBe("task-1");
    expect(jobs[1].task.id).toBe("task-2");
    expect(jobs[0].estimate.taskId).toBe("task-1");
    expect(jobs[1].estimate.taskId).toBe("task-2");
  });

  it("enqueue() returns jobs with queued status", () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus());
    const jobs = engine.enqueue(makePlan([makeTask({ id: "task-queued" })]));

    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].attempts).toBe(0);
    expect(jobs[0].maxAttempts).toBe(2);
    expect(typeof jobs[0].createdAt).toBe("number");
  });

  it("run() processes all queued jobs", async () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus());
    engine.enqueue(
      makePlan([
        makeTask({ id: "task-a" }),
        makeTask({ id: "task-b" }),
        makeTask({ id: "task-c" }),
      ]),
    );

    const result = await engine.run();

    expect(vi.mocked(createSandbox)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(executeTask)).toHaveBeenCalledTimes(3);
    expect(result.completed).toHaveLength(3);
    expect(result.jobs.every((job) => job.status === "completed")).toBe(true);
  });

  it("run() returns completed/failed/aborted job arrays", async () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus(), {
      maxAttempts: 1,
    });
    engine.enqueue(makePlan([makeTask({ id: "task-success" }), makeTask({ id: "task-failure" })]));

    vi.mocked(executeTask)
      .mockResolvedValueOnce(makeExecutionResult())
      .mockResolvedValueOnce(
        makeExecutionResult({
          success: false,
          exitCode: 1,
          error: "Task failed",
        }),
      );

    const result = await engine.run();

    expect(result.jobs).toHaveLength(2);
    expect(result.completed).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.aborted).toHaveLength(0);
    expect(result.failed[0].error?.code).toBe("AGENT_EXECUTION_FAILED");
  });

  it("abort() stops all running jobs", async () => {
    const eventBus = createEventBus();
    const agent = createMockAgent("agent-running");
    const engine = new ExecutionEngine([agent], eventBus, { concurrency: 1 });
    const [job] = engine.enqueue(makePlan([makeTask({ id: "task-running" })]));

    let rejectExecution: ((reason?: unknown) => void) | undefined;
    const blockedExecution = new Promise<ExecutionResult>((_resolve, reject) => {
      rejectExecution = reject;
    });

    vi.mocked(executeTask).mockImplementationOnce(() => blockedExecution);
    vi.mocked(agent.abort).mockImplementation(async () => {
      rejectExecution?.(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });

    const started = new Promise<void>((resolve) => {
      eventBus.once("execution:started", () => resolve());
    });

    const runPromise = engine.run();
    await started;
    await engine.abort();
    const result = await runPromise;

    expect(agent.abort).toHaveBeenCalledWith(job.id);
    expect(result.aborted).toHaveLength(1);
    expect(result.aborted[0].id).toBe(job.id);
  });

  it("abort() marks queued jobs as aborted", async () => {
    const eventBus = createEventBus();
    const agent = createMockAgent("agent-abort-queue");
    const engine = new ExecutionEngine([agent], eventBus, { concurrency: 1 });
    const jobs = engine.enqueue(
      makePlan([makeTask({ id: "task-running" }), makeTask({ id: "task-queued" })]),
    );

    let rejectExecution: ((reason?: unknown) => void) | undefined;
    const blockedExecution = new Promise<ExecutionResult>((_resolve, reject) => {
      rejectExecution = reject;
    });

    vi.mocked(executeTask)
      .mockImplementationOnce(() => blockedExecution)
      .mockResolvedValueOnce(makeExecutionResult());
    vi.mocked(agent.abort).mockImplementation(async () => {
      rejectExecution?.(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });

    const started = new Promise<void>((resolve) => {
      eventBus.once("execution:started", () => resolve());
    });

    const runPromise = engine.run();
    await started;
    await engine.abort();
    const result = await runPromise;

    const queuedJob = result.jobs.find((job) => job.id === jobs[1].id);
    expect(queuedJob).toBeDefined();
    expect(queuedJob?.status).toBe("aborted");
    expect(queuedJob?.error?.code).toBe("AGENT_EXECUTION_FAILED");
    expect(vi.mocked(executeTask)).toHaveBeenCalledTimes(1);
  });

  it("branch name includes date, task id segment, and attempt number", async () => {
    const engine = new ExecutionEngine([createMockAgent()], createEventBus());
    engine.enqueue(makePlan([makeTask({ id: "Task Segment/Alpha" })]));

    await engine.run();

    const branchName = vi.mocked(createSandbox).mock.calls[0][1];
    const dateSegment = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    expect(branchName).toMatch(
      new RegExp(`^oac/${dateSegment}/task-segment/alpha-[a-f0-9]{8}-a1$`),
    );
  });

  it("agent selection round-robins across available agents", async () => {
    const agentA = createMockAgent("agent-a");
    const agentB = createMockAgent("agent-b");
    const engine = new ExecutionEngine([agentA, agentB], createEventBus(), {
      concurrency: 1,
    });

    engine.enqueue(
      makePlan([
        makeTask({ id: "task-1" }),
        makeTask({ id: "task-2" }),
        makeTask({ id: "task-3" }),
      ]),
    );

    const result = await engine.run();

    expect(result.jobs.map((job) => job.workerId)).toEqual(["agent-a", "agent-b", "agent-a"]);
  });
});

describe("isTransientError", () => {
  it("returns true for AGENT_TIMEOUT, AGENT_OOM, NETWORK_ERROR, GIT_LOCK_FAILED", () => {
    const transientErrors = [
      executionError("AGENT_TIMEOUT", "timed out"),
      executionError("AGENT_OOM", "oom"),
      new OacError("network issue", "NETWORK_ERROR", "recoverable"),
      new OacError("git lock conflict", "GIT_LOCK_FAILED", "recoverable"),
    ];

    for (const error of transientErrors) {
      expect(isTransientError(error)).toBe(true);
    }
  });

  it("returns false for non-transient error codes", () => {
    const nonTransientErrors = [
      executionError("AGENT_EXECUTION_FAILED", "failed"),
      executionError("VALIDATION_TEST_FAILED", "tests failed"),
      new OacError("disk pressure", "DISK_SPACE_LOW", "warning"),
    ];

    for (const error of nonTransientErrors) {
      expect(isTransientError(error)).toBe(false);
    }
  });

  it("returns true for plain Error with timeout message", () => {
    expect(isTransientError(new Error("Request timed out"))).toBe(true);
    expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("returns true for plain Error with ECONNRESET message", () => {
    expect(isTransientError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("returns true for rate-limit / 429 errors", () => {
    expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
    expect(isTransientError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });

  it("returns true for 503 / service unavailable errors", () => {
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("service unavailable"))).toBe(true);
  });

  it("returns false for plain non-transient errors and non-error values", () => {
    expect(isTransientError(new Error("syntax error in file.ts"))).toBe(false);
    expect(isTransientError("just a string")).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe("calculateBackoff", () => {
  it("returns a value >= base (1000ms) for attempt 0", () => {
    const value = calculateBackoff(0);
    // base * 2^0 = 1000, plus jitter 0-500
    expect(value).toBeGreaterThanOrEqual(1000);
    expect(value).toBeLessThanOrEqual(1500);
  });

  it("increases exponentially with attempt number", () => {
    // For attempt 3: min(1000 * 2^3, 30000) = 8000, plus jitter 0-500
    const value = calculateBackoff(3);
    expect(value).toBeGreaterThanOrEqual(8000);
    expect(value).toBeLessThanOrEqual(8500);
  });

  it("caps at 30000ms plus jitter", () => {
    // For attempt 10: min(1000 * 2^10, 30000) = 30000, plus jitter 0-500
    const value = calculateBackoff(10);
    expect(value).toBeGreaterThanOrEqual(30000);
    expect(value).toBeLessThanOrEqual(30500);
  });

  it("includes random jitter (not always same value)", () => {
    // Run multiple times and check we don't always get the exact same result
    const values = new Set(Array.from({ length: 20 }, () => calculateBackoff(0)));
    // With 20 samples and a jitter range of 0-500, we almost certainly get > 1 distinct value
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
  });

  it("remains closed after fewer failures than threshold", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
  });

  it("opens after 3 consecutive failures", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isOpen()).toBe(true);
  });

  it("resets failure count on success", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    // After success, counter resets — one more failure should not open
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
  });

  it("transitions to half-open after cooldown period", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);

    // Advance time past the 60s cooldown
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect(cb.isOpen()).toBe(false); // probe allowed
    expect(cb.getState()).toBe("half-open");
    vi.restoreAllMocks();
  });

  it("closes from half-open on success", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    cb.isOpen(); // triggers half-open
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
    vi.restoreAllMocks();
  });

  it("reset() force-closes the circuit", () => {
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
  });
});
