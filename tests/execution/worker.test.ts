import { beforeEach, describe, expect, it, vi } from "vitest";

import { OacError, type Task, createEventBus } from "../../src/core/index.js";
import type {
  AgentEvent,
  AgentProvider,
  AgentResult,
} from "../../src/execution/agents/agent.interface.js";
import type { SandboxContext } from "../../src/execution/sandbox.js";
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

function makeSandbox(): SandboxContext {
  return {
    path: "/tmp/sandbox",
    branchName: "oac/test",
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    exitCode: 0,
    totalTokensUsed: 100,
    filesChanged: [],
    duration: 2_000,
    ...overrides,
  };
}

function toAsyncEvents(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createMockAgent(id = "test-agent"): AgentProvider {
  return {
    id,
    name: "Test Agent",
    checkAvailability: vi.fn().mockResolvedValue({ available: true, version: "1.0.0" }),
    execute: vi.fn(),
    estimateTokens: vi.fn().mockResolvedValue({
      taskId: "task-1",
      providerId: id,
      contextTokens: 100,
      promptTokens: 100,
      expectedOutputTokens: 100,
      totalEstimatedTokens: 300,
      confidence: 0.8,
      feasible: true,
    }),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

function mockExecution(
  agent: AgentProvider,
  events: AgentEvent[],
  result: Promise<AgentResult>,
): void {
  vi.mocked(agent.execute).mockReturnValue({
    executionId: "agent-execution-id",
    providerId: agent.id,
    events: toAsyncEvents(events),
    result,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executeTask", () => {
  it("calls agent.execute with correct prompt and options", async () => {
    const agent = createMockAgent();
    const task = makeTask();
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(agent, [], Promise.resolve(makeAgentResult()));

    await executeTask(agent, task, sandbox, eventBus, {
      executionId: "execution-1",
      tokenBudget: 1_234,
      timeoutMs: 9_999,
      allowCommits: false,
    });

    expect(agent.execute).toHaveBeenCalledTimes(1);
    const params = vi.mocked(agent.execute).mock.calls[0][0];
    expect(params.executionId).toBe("execution-1");
    expect(params.workingDirectory).toBe("/tmp/sandbox");
    expect(params.tokenBudget).toBe(1_234);
    expect(params.timeoutMs).toBe(9_999);
    expect(params.allowCommits).toBe(false);
    expect(params.targetFiles).toEqual(task.targetFiles);
    expect(params.prompt).toContain(`Task ID: ${task.id}`);
  });

  it("returns ExecutionResult on success", async () => {
    const agent = createMockAgent();
    const task = makeTask();
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(
      agent,
      [],
      Promise.resolve(
        makeAgentResult({
          success: true,
          exitCode: 0,
          totalTokensUsed: 420,
          filesChanged: ["src/file.ts"],
          duration: 1_500,
        }),
      ),
    );

    const result = await executeTask(agent, task, sandbox, eventBus, {
      executionId: "success-1",
    });

    expect(result).toEqual({
      success: true,
      exitCode: 0,
      totalTokensUsed: 420,
      filesChanged: ["src/file.ts"],
      duration: 1_500,
      error: undefined,
    });
  });

  it("tracks tokens from events", async () => {
    const agent = createMockAgent();
    const task = makeTask();
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(
      agent,
      [
        {
          type: "tokens",
          inputTokens: 100,
          outputTokens: 50,
          cumulativeTokens: 150,
        },
        {
          type: "tokens",
          inputTokens: 200,
          outputTokens: 80,
          cumulativeTokens: 280,
        },
      ],
      Promise.resolve(
        makeAgentResult({
          totalTokensUsed: 120,
        }),
      ),
    );

    const result = await executeTask(agent, task, sandbox, eventBus, {
      executionId: "tokens-1",
    });

    expect(result.totalTokensUsed).toBe(280);
  });

  it("tracks file edits from events", async () => {
    const agent = createMockAgent();
    const task = makeTask();
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(
      agent,
      [
        {
          type: "file_edit",
          path: "src/edited-a.ts",
          action: "modify",
        },
        {
          type: "file_edit",
          path: "src/edited-b.ts",
          action: "create",
        },
      ],
      Promise.resolve(
        makeAgentResult({
          filesChanged: ["src/edited-b.ts", "src/edited-c.ts"],
        }),
      ),
    );

    const result = await executeTask(agent, task, sandbox, eventBus, {
      executionId: "files-1",
    });

    expect(result.filesChanged).toHaveLength(3);
    expect(result.filesChanged).toEqual(
      expect.arrayContaining(["src/edited-a.ts", "src/edited-b.ts", "src/edited-c.ts"]),
    );
  });

  it("emits execution:progress events", async () => {
    const agent = createMockAgent();
    const task = makeTask();
    const sandbox = makeSandbox();
    const eventBus = createEventBus();
    const progressEvents: Array<{
      jobId: string;
      tokensUsed: number;
      stage: string;
    }> = [];

    eventBus.on("execution:progress", (payload) => {
      progressEvents.push(payload);
    });

    mockExecution(
      agent,
      [
        {
          type: "output",
          content: "working",
          stream: "stdout",
        },
        {
          type: "tokens",
          inputTokens: 50,
          outputTokens: 20,
          cumulativeTokens: 70,
        },
        {
          type: "file_edit",
          path: "src/file.ts",
          action: "modify",
        },
        {
          type: "tool_use",
          tool: "rg",
          input: { pattern: "TODO" },
        },
        {
          type: "error",
          message: "temporary warning",
          recoverable: true,
        },
      ],
      Promise.resolve(makeAgentResult()),
    );

    await executeTask(agent, task, sandbox, eventBus, {
      executionId: "progress-1",
    });

    expect(progressEvents).toHaveLength(5);
    expect(progressEvents.map((event) => event.stage)).toEqual([
      "stdout",
      "tokens",
      "file:modify",
      "tool:rg",
      "agent-warning",
    ]);
    expect(progressEvents.map((event) => event.tokensUsed)).toEqual([0, 70, 70, 70, 70]);
    expect(progressEvents.every((event) => event.jobId === "progress-1")).toBe(true);
  });

  it("normalizes timeout errors to AGENT_TIMEOUT", async () => {
    const agent = createMockAgent();
    const task = makeTask({ id: "task-timeout" });
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(agent, [], Promise.reject(new Error("operation timed out")));

    let thrown: unknown;
    try {
      await executeTask(agent, task, sandbox, eventBus, {
        executionId: "timeout-1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OacError);
    expect((thrown as OacError).code).toBe("AGENT_TIMEOUT");
    expect((thrown as OacError).context?.taskId).toBe("task-timeout");
    expect((thrown as OacError).context?.executionId).toBe("timeout-1");
  });

  it("normalizes generic errors to AGENT_EXECUTION_FAILED", async () => {
    const agent = createMockAgent();
    const task = makeTask({ id: "task-failure" });
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(agent, [], Promise.reject(new Error("unexpected failure")));

    let thrown: unknown;
    try {
      await executeTask(agent, task, sandbox, eventBus, {
        executionId: "failure-1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OacError);
    expect((thrown as OacError).code).toBe("AGENT_EXECUTION_FAILED");
    expect((thrown as OacError).context?.taskId).toBe("task-failure");
    expect((thrown as OacError).context?.executionId).toBe("failure-1");
  });

  it("task prompt includes task id, title, source, and target files", async () => {
    const agent = createMockAgent();
    const task = makeTask({
      id: "task-prompt",
      title: "Refactor parser",
      source: "test-gap",
      targetFiles: ["src/parser.ts", "tests/parser.test.ts"],
    });
    const sandbox = makeSandbox();
    const eventBus = createEventBus();

    mockExecution(agent, [], Promise.resolve(makeAgentResult()));

    await executeTask(agent, task, sandbox, eventBus, {
      executionId: "prompt-1",
    });

    const prompt = vi.mocked(agent.execute).mock.calls[0][0].prompt;
    expect(prompt).toContain("Task ID: task-prompt");
    expect(prompt).toContain("Title: Refactor parser");
    expect(prompt).toContain("Source: test-gap");
    expect(prompt).toContain("src/parser.ts");
    expect(prompt).toContain("tests/parser.test.ts");
  });
});
