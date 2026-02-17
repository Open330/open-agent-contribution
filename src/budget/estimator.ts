import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { Epic } from "../core/types.js";
import { analyzeTaskComplexity } from "./complexity.js";
import { ClaudeTokenCounter } from "./providers/claude-counter.js";
import { CodexTokenCounter } from "./providers/codex-counter.js";

export type AgentProviderId = "claude-code" | "codex" | "opencode" | string;

export type TaskSource = "lint" | "todo" | "test-gap" | "dead-code" | "github-issue" | "custom";

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex";

export type ExecutionMode = "new-pr" | "update-pr" | "direct-commit";

export interface Task {
  id: string;
  source: TaskSource;
  title: string;
  description: string;
  targetFiles: string[];
  priority: number;
  complexity: TaskComplexity;
  executionMode: ExecutionMode;
  linkedIssue?: {
    number: number;
    url: string;
    labels: string[];
  };
  metadata: Record<string, unknown>;
  discoveredAt: string;
}

export interface TokenEstimate {
  taskId: string;
  providerId: AgentProviderId;
  contextTokens: number;
  promptTokens: number;
  expectedOutputTokens: number;
  totalEstimatedTokens: number;
  confidence: number;
  feasible: boolean;
  estimatedCostUsd?: number;
}

export interface TokenCounter {
  countTokens(text: string): number;
  readonly invocationOverhead: number;
  readonly maxContextTokens: number;
}

interface TokenCountResult {
  tokens: number;
  usedFallback: boolean;
}

interface ContextFileResult extends TokenCountResult {
  missing: boolean;
}

const ESTIMATION_PADDING_MULTIPLIER = 1.2;
const FALLBACK_CONFIDENCE = 0.5;

const COMPLEXITY_MULTIPLIERS: Record<TaskComplexity, number> = {
  trivial: 0.5,
  simple: 1,
  moderate: 2,
  complex: 3.5,
};

const COMPLEXITY_CONFIDENCE: Record<TaskComplexity, number> = {
  trivial: 0.9,
  simple: 0.75,
  moderate: 0.6,
  complex: 0.4,
};

const COMPLEXITY_ORDER: Record<TaskComplexity, number> = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
};

const claudeCounter = new ClaudeTokenCounter();
const codexCounter = new CodexTokenCounter();

function getTokenCounter(provider: AgentProviderId): TokenCounter {
  if (provider === "claude-code") {
    return claudeCounter;
  }

  return codexCounter;
}

function approximateTokenCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

function countTokensWithFallback(text: string, counter: TokenCounter): TokenCountResult {
  try {
    return {
      tokens: counter.countTokens(text),
      usedFallback: false,
    };
  } catch {
    return {
      tokens: approximateTokenCount(text),
      usedFallback: true,
    };
  }
}

function chooseConservativeComplexity(
  declaredComplexity: TaskComplexity,
  analyzedComplexity: TaskComplexity,
): TaskComplexity {
  return COMPLEXITY_ORDER[declaredComplexity] >= COMPLEXITY_ORDER[analyzedComplexity]
    ? declaredComplexity
    : analyzedComplexity;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function resolveTargetFilePath(targetFile: string): string {
  return isAbsolute(targetFile) ? targetFile : resolve(process.cwd(), targetFile);
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "null";
  } catch {
    return "[unserializable]";
  }
}

async function readContextFile(
  targetFile: string,
  counter: TokenCounter,
): Promise<ContextFileResult> {
  const resolvedPath = resolveTargetFilePath(targetFile);

  try {
    const content = await readFile(resolvedPath, "utf8");
    const counted = countTokensWithFallback(content, counter);

    return {
      ...counted,
      missing: false,
    };
  } catch {
    return {
      tokens: 0,
      usedFallback: false,
      missing: true,
    };
  }
}

export async function estimateTokens(
  task: Task,
  provider: AgentProviderId,
): Promise<TokenEstimate> {
  const counter = getTokenCounter(provider);
  const uniqueTargetFiles = [...new Set(task.targetFiles)];

  const fileResults = await Promise.all(
    uniqueTargetFiles.map((targetFile) => readContextFile(targetFile, counter)),
  );

  const repoStructureSeed = uniqueTargetFiles.join("\n");
  const repoStructureCount = countTokensWithFallback(repoStructureSeed, counter);

  const contextTokens =
    repoStructureCount.tokens + fileResults.reduce((sum, result) => sum + result.tokens, 0);

  const promptSeed = [
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Source: ${task.source}`,
    `Priority: ${task.priority}`,
    `Description:\n${task.description}`,
    `Target Files:\n${uniqueTargetFiles.join("\n") || "(none)"}`,
    `Metadata: ${safeStringify(task.metadata)}`,
  ].join("\n\n");

  const promptContentCount = countTokensWithFallback(promptSeed, counter);
  const promptTokens = counter.invocationOverhead + promptContentCount.tokens;

  const analyzedComplexity = analyzeTaskComplexity(task);
  const effectiveComplexity = chooseConservativeComplexity(task.complexity, analyzedComplexity);
  const expectedOutputTokens = Math.ceil(
    contextTokens * COMPLEXITY_MULTIPLIERS[effectiveComplexity],
  );

  const rawTotalTokens = contextTokens + promptTokens + expectedOutputTokens;
  const totalEstimatedTokens = Math.ceil(rawTotalTokens * ESTIMATION_PADDING_MULTIPLIER);

  const usedFallback =
    repoStructureCount.usedFallback ||
    promptContentCount.usedFallback ||
    fileResults.some((result) => result.usedFallback);

  const missingFileCount = fileResults.filter((result) => result.missing).length;

  let confidence = COMPLEXITY_CONFIDENCE[effectiveComplexity];
  if (usedFallback) {
    confidence = Math.min(confidence, FALLBACK_CONFIDENCE);
  }

  if (missingFileCount > 0) {
    confidence -= Math.min(0.25, missingFileCount * 0.05);
  }

  if (uniqueTargetFiles.length === 0) {
    confidence -= 0.1;
  }

  if (task.complexity !== analyzedComplexity) {
    confidence -= 0.05;
  }

  const feasible = totalEstimatedTokens <= counter.maxContextTokens;

  return {
    taskId: task.id,
    providerId: provider,
    contextTokens,
    promptTokens,
    expectedOutputTokens,
    totalEstimatedTokens,
    confidence: clamp(confidence, 0.1, 0.95),
    feasible,
  };
}

// ── Epic token estimation ────────────────────────────────────

const EPIC_CONTEXT_OVERHEAD = 1.2; // 20% overhead for shared module understanding

/**
 * Estimate tokens for an entire epic by summing subtask estimates
 * plus a 20% context overhead for shared module understanding.
 */
export async function estimateEpicTokens(epic: Epic, provider: AgentProviderId): Promise<number> {
  if (epic.subtasks.length === 0) {
    return 0;
  }

  const subtaskEstimates = await Promise.all(
    epic.subtasks.map((task) => estimateTokens(task, provider)),
  );

  const subtaskTotal = subtaskEstimates.reduce(
    (sum, estimate) => sum + estimate.totalEstimatedTokens,
    0,
  );

  return Math.ceil(subtaskTotal * EPIC_CONTEXT_OVERHEAD);
}
