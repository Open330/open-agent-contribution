import { describe, expect, it } from "vitest";

import type { Task, TokenEstimate } from "../src/estimator.js";
import { buildExecutionPlan } from "../src/planner.js";
import type { ExecutionPlan } from "../src/planner.js";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    source: "lint",
    title: `Task ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    targetFiles: ["src/file.ts"],
    priority: 50,
    complexity: "simple",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEstimate(
  taskId: string,
  totalEstimatedTokens: number,
  overrides: Partial<TokenEstimate> = {},
): TokenEstimate {
  return {
    taskId,
    providerId: "claude-code",
    contextTokens: Math.floor(totalEstimatedTokens * 0.4),
    promptTokens: Math.floor(totalEstimatedTokens * 0.2),
    expectedOutputTokens: Math.floor(totalEstimatedTokens * 0.4),
    totalEstimatedTokens,
    confidence: 0.75,
    feasible: true,
    ...overrides,
  };
}

describe("buildExecutionPlan with normal budget", () => {
  it("selects tasks that fit within the effective budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 }), makeTask({ id: "t2", priority: 60 })];
    const estimates = new Map<string, TokenEstimate>([
      ["t1", makeEstimate("t1", 5_000)],
      ["t2", makeEstimate("t2", 3_000)],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.totalBudget).toBe(100_000);
    expect(plan.selectedTasks).toHaveLength(2);
    expect(plan.deferredTasks).toHaveLength(0);
  });

  it("sets cumulative budget used correctly", () => {
    const tasks = [makeTask({ id: "t1", priority: 50 }), makeTask({ id: "t2", priority: 50 })];
    const estimates = new Map<string, TokenEstimate>([
      ["t1", makeEstimate("t1", 10_000)],
      ["t2", makeEstimate("t2", 10_000)],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(2);
    // Both tasks have same priority/token ratio so order is deterministic by tokens
    const cumulative = plan.selectedTasks.map((s) => s.cumulativeBudgetUsed);
    expect(cumulative[0]).toBe(10_000);
    expect(cumulative[1]).toBe(20_000);
  });

  it("computes remainingTokens correctly", () => {
    const tasks = [makeTask({ id: "t1", priority: 50 })];
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 20_000)]]);

    // budget=100_000, reserve=10_000, effective=90_000, used=20_000
    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.reserveTokens).toBe(10_000);
    expect(plan.remainingTokens).toBe(70_000);
  });
});

describe("buildExecutionPlan with budget=0", () => {
  it("returns empty plan when budget is 0", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 5_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, 0);

    expect(plan.totalBudget).toBe(0);
    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.reserveTokens).toBe(0);
    expect(plan.remainingTokens).toBe(0);
    // task should be deferred as budget_exceeded
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("budget_exceeded");
  });

  it("returns empty plan for negative budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 1_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, -500);

    expect(plan.totalBudget).toBe(0);
    expect(plan.selectedTasks).toHaveLength(0);
  });

  it("returns empty plan for NaN budget", () => {
    const plan = buildExecutionPlan([], new Map(), Number.NaN);
    expect(plan.totalBudget).toBe(0);
    expect(plan.selectedTasks).toHaveLength(0);
  });

  it("returns empty plan for Infinity budget", () => {
    const plan = buildExecutionPlan([], new Map(), Number.POSITIVE_INFINITY);
    expect(plan.totalBudget).toBe(0);
  });
});

describe("10% reserve is applied", () => {
  it("reserves exactly 10% of the total budget", () => {
    const tasks: Task[] = [];
    const estimates = new Map<string, TokenEstimate>();

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.reserveTokens).toBe(10_000);
    expect(plan.remainingTokens).toBe(90_000);
  });

  it("reserve prevents task selection if task would exceed effective budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    // effective budget = 100_000 - 10_000 = 90_000
    // task needs 95_000 tokens -> should be deferred
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 95_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.reserveTokens).toBe(10_000);
    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("budget_exceeded");
  });

  it("selects a task that fits exactly within the effective budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    // effective budget = 100_000 - 10_000 = 90_000
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 90_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(1);
    expect(plan.remainingTokens).toBe(0);
  });

  it("floors reserve for non-round budgets", () => {
    const plan = buildExecutionPlan([], new Map(), 99_999);

    // floor(99_999 * 0.1) = floor(9999.9) = 9999
    expect(plan.reserveTokens).toBe(9_999);
  });
});

describe("tasks sorted by priority/token ratio", () => {
  it("prefers high priority / low token tasks", () => {
    const tasks = [
      makeTask({ id: "low-ratio", priority: 10 }),
      makeTask({ id: "high-ratio", priority: 100 }),
    ];
    const estimates = new Map<string, TokenEstimate>([
      // low-ratio: priority 10 / 10_000 tokens = 0.001
      ["low-ratio", makeEstimate("low-ratio", 10_000)],
      // high-ratio: priority 100 / 10_000 tokens = 0.01
      ["high-ratio", makeEstimate("high-ratio", 10_000)],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(2);
    expect(plan.selectedTasks[0].task.id).toBe("high-ratio");
    expect(plan.selectedTasks[1].task.id).toBe("low-ratio");
  });

  it("breaks ties by higher priority first", () => {
    const tasks = [makeTask({ id: "a", priority: 50 }), makeTask({ id: "b", priority: 80 })];
    // Same ratio: both priority/tokens = same value? No, different priorities.
    // a: 50/5000=0.01, b: 80/8000=0.01 -> same ratio -> tiebreak by priority
    const estimates = new Map<string, TokenEstimate>([
      ["a", makeEstimate("a", 5_000)],
      ["b", makeEstimate("b", 8_000)],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(2);
    expect(plan.selectedTasks[0].task.id).toBe("b");
    expect(plan.selectedTasks[1].task.id).toBe("a");
  });

  it("breaks ties by lower token cost when priority also matches", () => {
    const tasks = [
      makeTask({ id: "expensive", priority: 50 }),
      makeTask({ id: "cheap", priority: 50 }),
    ];
    // same priority/token ratio: 50/10_000 = 50/10_000 and same priority
    // tiebreak: lower totalEstimatedTokens first
    const estimates = new Map<string, TokenEstimate>([
      ["expensive", makeEstimate("expensive", 10_000)],
      ["cheap", makeEstimate("cheap", 5_000)],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    // cheap has higher ratio (50/5000=0.01 > 50/10000=0.005)
    expect(plan.selectedTasks[0].task.id).toBe("cheap");
    expect(plan.selectedTasks[1].task.id).toBe("expensive");
  });
});

describe("deferred tasks are captured", () => {
  it("defers tasks that exceed the effective budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 }), makeTask({ id: "t2", priority: 60 })];
    const estimates = new Map<string, TokenEstimate>([
      ["t1", makeEstimate("t1", 50_000)],
      ["t2", makeEstimate("t2", 50_000)],
    ]);

    // effective = 100_000 - 10_000 = 90_000; t1 (50k) fits, t2 (50k) overflows
    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(1);
    expect(plan.selectedTasks[0].task.id).toBe("t1");
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].task.id).toBe("t2");
    expect(plan.deferredTasks[0].reason).toBe("budget_exceeded");
  });

  it("defers tasks with low confidence", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    const estimates = new Map<string, TokenEstimate>([
      ["t1", makeEstimate("t1", 5_000, { confidence: 0.3 })],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("low_confidence");
  });

  it("defers infeasible tasks", () => {
    const tasks = [makeTask({ id: "t1", priority: 80 })];
    const estimates = new Map<string, TokenEstimate>([
      ["t1", makeEstimate("t1", 5_000, { feasible: false })],
    ]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("budget_exceeded");
  });

  it("defers complex tasks that would consume more than 60% of effective budget", () => {
    const tasks = [makeTask({ id: "t1", priority: 80, complexity: "complex" })];
    // effective budget = 90_000; 60% = 54_000
    // task costs 60_000 -> exceeds 60% share -> too_complex
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 60_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("too_complex");
  });

  it("does not defer complex tasks that fit within 60% share", () => {
    const tasks = [makeTask({ id: "t1", priority: 80, complexity: "complex" })];
    // effective budget = 90_000; 60% = 54_000
    // task costs 50_000 -> under 60% share -> not too_complex
    const estimates = new Map<string, TokenEstimate>([["t1", makeEstimate("t1", 50_000)]]);

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    expect(plan.selectedTasks).toHaveLength(1);
    expect(plan.deferredTasks).toHaveLength(0);
  });

  it("uses a fallback estimate for tasks without an estimate", () => {
    const tasks = [makeTask({ id: "no-estimate", priority: 80 })];
    const estimates = new Map<string, TokenEstimate>();

    const plan = buildExecutionPlan(tasks, estimates, 100_000);

    // Fallback estimate has feasible=false, so it should be deferred
    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(1);
    expect(plan.deferredTasks[0].reason).toBe("budget_exceeded");
  });

  it("handles empty task list gracefully", () => {
    const plan = buildExecutionPlan([], new Map(), 100_000);

    expect(plan.totalBudget).toBe(100_000);
    expect(plan.selectedTasks).toHaveLength(0);
    expect(plan.deferredTasks).toHaveLength(0);
    expect(plan.reserveTokens).toBe(10_000);
    expect(plan.remainingTokens).toBe(90_000);
  });
});
