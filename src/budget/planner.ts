import type { Epic } from "../core/types.js";
import type { AgentProviderId, Task, TokenEstimate } from "./estimator.js";

const DEFAULT_RESERVE_PERCENT = 0.1;
const MIN_CONFIDENCE_THRESHOLD = 0.5;
const TOO_COMPLEX_BUDGET_SHARE = 0.6;

type DeferredReason = "budget_exceeded" | "low_confidence" | "too_complex";

export interface ExecutionPlan {
  totalBudget: number;
  selectedTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    cumulativeBudgetUsed: number;
  }>;
  deferredTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    reason: DeferredReason;
  }>;
  reserveTokens: number;
  remainingTokens: number;
}

interface CandidateTask {
  task: Task;
  estimate: TokenEstimate;
}

function normalizeBudget(budget: number): number {
  if (!Number.isFinite(budget) || budget <= 0) {
    return 0;
  }

  return Math.floor(budget);
}

function getFallbackEstimate(task: Task): TokenEstimate {
  return {
    taskId: task.id,
    providerId: "unknown" as AgentProviderId,
    contextTokens: 0,
    promptTokens: 0,
    expectedOutputTokens: 0,
    totalEstimatedTokens: Number.MAX_SAFE_INTEGER,
    confidence: 0,
    feasible: false,
  };
}

function classifyDeferredReason(
  task: Task,
  estimate: TokenEstimate,
  effectiveBudget: number,
): DeferredReason | undefined {
  if (!estimate.feasible) {
    return "budget_exceeded";
  }

  if (estimate.confidence < MIN_CONFIDENCE_THRESHOLD) {
    return "low_confidence";
  }

  if (
    task.complexity === "complex" &&
    effectiveBudget > 0 &&
    estimate.totalEstimatedTokens > effectiveBudget * TOO_COMPLEX_BUDGET_SHARE
  ) {
    return "too_complex";
  }

  return undefined;
}

function scoreByPriorityPerToken(task: Task, estimate: TokenEstimate): number {
  if (estimate.totalEstimatedTokens <= 0) {
    return task.priority;
  }

  return task.priority / estimate.totalEstimatedTokens;
}

export function buildExecutionPlan(
  tasks: Task[],
  estimates: Map<string, TokenEstimate>,
  budget: number,
): ExecutionPlan {
  const totalBudget = normalizeBudget(budget);
  const reserveTokens = Math.floor(totalBudget * DEFAULT_RESERVE_PERCENT);
  const effectiveBudget = Math.max(0, totalBudget - reserveTokens);

  const deferredTasks: ExecutionPlan["deferredTasks"] = [];
  const candidates: CandidateTask[] = [];

  for (const task of tasks) {
    const estimate = estimates.get(task.id) ?? getFallbackEstimate(task);
    const reason = classifyDeferredReason(task, estimate, effectiveBudget);

    if (reason) {
      deferredTasks.push({ task, estimate, reason });
      continue;
    }

    candidates.push({ task, estimate });
  }

  candidates.sort((left, right) => {
    const ratioDifference =
      scoreByPriorityPerToken(right.task, right.estimate) -
      scoreByPriorityPerToken(left.task, left.estimate);

    if (ratioDifference !== 0) {
      return ratioDifference;
    }

    const priorityDifference = right.task.priority - left.task.priority;
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return left.estimate.totalEstimatedTokens - right.estimate.totalEstimatedTokens;
  });

  const selectedTasks: ExecutionPlan["selectedTasks"] = [];
  let budgetUsed = 0;

  for (const candidate of candidates) {
    const nextBudgetUsed = budgetUsed + candidate.estimate.totalEstimatedTokens;

    if (nextBudgetUsed <= effectiveBudget) {
      budgetUsed = nextBudgetUsed;
      selectedTasks.push({
        task: candidate.task,
        estimate: candidate.estimate,
        cumulativeBudgetUsed: budgetUsed,
      });
      continue;
    }

    deferredTasks.push({
      task: candidate.task,
      estimate: candidate.estimate,
      reason: "budget_exceeded",
    });
  }

  return {
    totalBudget,
    selectedTasks,
    deferredTasks,
    reserveTokens,
    remainingTokens: Math.max(0, effectiveBudget - budgetUsed),
  };
}

// ── Epic execution plan ─────────────────────────────────────

export interface EpicExecutionPlan {
  totalBudget: number;
  selectedEpics: Array<{
    epic: Epic;
    estimatedTokens: number;
    cumulativeBudgetUsed: number;
  }>;
  deferredEpics: Array<{
    epic: Epic;
    estimatedTokens: number;
    reason: "budget_exceeded";
  }>;
  reserveTokens: number;
  remainingTokens: number;
}

/**
 * Build an execution plan for epics. Unlike task-level planning, epics are
 * sorted purely by priority (not priority/tokens ratio) since they are
 * already coherent units of work.
 */
export function buildEpicExecutionPlan(epics: Epic[], budget: number): EpicExecutionPlan {
  const totalBudget = normalizeBudget(budget);
  const reserveTokens = Math.floor(totalBudget * DEFAULT_RESERVE_PERCENT);
  const effectiveBudget = Math.max(0, totalBudget - reserveTokens);

  // Sort by priority descending (highest priority first)
  const sorted = [...epics].sort((a, b) => b.priority - a.priority);

  const selectedEpics: EpicExecutionPlan["selectedEpics"] = [];
  const deferredEpics: EpicExecutionPlan["deferredEpics"] = [];
  let budgetUsed = 0;

  for (const epic of sorted) {
    const tokens = epic.estimatedTokens;
    const nextBudgetUsed = budgetUsed + tokens;

    if (nextBudgetUsed <= effectiveBudget) {
      budgetUsed = nextBudgetUsed;
      selectedEpics.push({
        epic,
        estimatedTokens: tokens,
        cumulativeBudgetUsed: budgetUsed,
      });
    } else {
      deferredEpics.push({
        epic,
        estimatedTokens: tokens,
        reason: "budget_exceeded",
      });
    }
  }

  return {
    totalBudget,
    selectedEpics,
    deferredEpics,
    reserveTokens,
    remainingTokens: Math.max(0, effectiveBudget - budgetUsed),
  };
}
