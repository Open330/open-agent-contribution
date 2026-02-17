import { randomUUID } from "node:crypto";

import {
  type ExecutionResult,
  OacError,
  type OacEventBus,
  type Task,
  executionError,
} from "../core/index.js";

import type { AgentEvent, AgentProvider, AgentResult } from "./agents/agent.interface.js";
import type { SandboxContext } from "./sandbox.js";

const DEFAULT_TOKEN_BUDGET = 50_000;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface ExecuteTaskOptions {
  executionId?: string;
  tokenBudget?: number;
  timeoutMs?: number;
  allowCommits?: boolean;
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function readMetadataNumber(task: Task, key: string): number | undefined {
  return readPositiveNumber(task.metadata[key]);
}

function buildTaskPrompt(task: Task): string {
  const fileList = task.targetFiles.length > 0 ? task.targetFiles.join("\n") : "(none provided)";

  const lines = [
    "You are implementing a scoped repository contribution task.",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Source: ${task.source}`,
    `Priority: ${task.priority}`,
    `Complexity: ${task.complexity}`,
    `Execution mode: ${task.executionMode}`,
  ];

  if (task.linkedIssue) {
    lines.push(
      "",
      `GitHub Issue #${task.linkedIssue.number}: ${task.linkedIssue.url}`,
      task.linkedIssue.labels.length > 0
        ? `Labels: ${task.linkedIssue.labels.join(", ")}`
        : "",
      "Resolve this issue completely. Read the issue description carefully and implement the fix.",
    );
  }

  lines.push(
    "",
    "Description:",
    task.description,
    "",
    "Target files:",
    fileList,
    "",
    "Apply minimal, safe changes and ensure the repository remains buildable.",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

function stageFromEvent(event: AgentEvent): string {
  switch (event.type) {
    case "output":
      return event.stream;
    case "tokens":
      return "tokens";
    case "file_edit":
      return `file:${event.action}`;
    case "tool_use":
      return `tool:${event.tool}`;
    case "error":
      return event.recoverable ? "agent-warning" : "agent-error";
    default:
      return "running";
  }
}

function mergeExecutionResult(
  result: AgentResult,
  observedTokens: number,
  observedFiles: Set<string>,
  startedAt: number,
): ExecutionResult {
  for (const changedFile of result.filesChanged) {
    observedFiles.add(changedFile);
  }

  return {
    success: result.success,
    exitCode: result.exitCode,
    totalTokensUsed: Math.max(result.totalTokensUsed, observedTokens),
    filesChanged: [...observedFiles],
    duration: result.duration > 0 ? result.duration : Date.now() - startedAt,
    error: result.error,
  };
}

function normalizeExecutionError(error: unknown, task: Task, executionId: string): OacError {
  if (error instanceof OacError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return executionError("AGENT_TIMEOUT", `Task ${task.id} timed out during execution.`, {
      context: {
        taskId: task.id,
        executionId,
        message,
      },
      cause: error,
    });
  }

  return executionError("AGENT_EXECUTION_FAILED", `Task ${task.id} failed during execution.`, {
    context: {
      taskId: task.id,
      executionId,
      message,
    },
    cause: error,
  });
}

export async function executeTask(
  agent: AgentProvider,
  task: Task,
  sandbox: SandboxContext,
  eventBus: OacEventBus,
  options: ExecuteTaskOptions = {},
): Promise<ExecutionResult> {
  const executionId = options.executionId ?? randomUUID();
  const tokenBudget =
    options.tokenBudget ?? readMetadataNumber(task, "tokenBudget") ?? DEFAULT_TOKEN_BUDGET;
  const timeoutMs =
    options.timeoutMs ?? readMetadataNumber(task, "timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  const allowCommits = options.allowCommits ?? true;

  const startedAt = Date.now();
  let observedTokens = 0;
  const observedFiles = new Set<string>();

  const execution = agent.execute({
    executionId,
    workingDirectory: sandbox.path,
    prompt: buildTaskPrompt(task),
    targetFiles: task.targetFiles,
    tokenBudget,
    allowCommits,
    timeoutMs,
  });

  const streamPromise = (async (): Promise<void> => {
    for await (const event of execution.events) {
      if (event.type === "tokens") {
        observedTokens = Math.max(observedTokens, event.cumulativeTokens);
      }

      if (event.type === "file_edit") {
        observedFiles.add(event.path);
      }

      eventBus.emit("execution:progress", {
        jobId: executionId,
        tokensUsed: observedTokens,
        stage: stageFromEvent(event),
      });
    }
  })();

  try {
    const result = await execution.result;
    await streamPromise;
    return mergeExecutionResult(result, observedTokens, observedFiles, startedAt);
  } catch (error) {
    try {
      await streamPromise;
    } catch {
      // Ignore stream failures and surface the primary execution error.
    }
    throw normalizeExecutionError(error, task, executionId);
  }
}
