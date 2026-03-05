import { randomUUID } from "node:crypto";

import type { Epic, ExecutionResult, OacEventBus, Task } from "../core/index.js";

import type { AgentEvent, AgentProvider, AgentResult } from "./agents/agent.interface.js";
import { normalizeExecutionError } from "./normalize-error.js";
import type { SandboxContext } from "./sandbox.js";

const DEFAULT_TOKEN_BUDGET = 50_000;
const DEFAULT_TIMEOUT_MS = 300_000;

export interface ExecuteTaskOptions {
  executionId?: string;
  tokenBudget?: number;
  timeoutMs?: number;
  allowCommits?: boolean;
  onEvent?: (event: AgentEvent) => void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readContextAck(task: Task):
  | {
      files: string[];
      summary: string[];
      digest?: string;
    }
  | undefined {
  const raw = task.metadata.contextAck;
  if (!isRecord(raw)) {
    return undefined;
  }

  const files = Array.isArray(raw.files)
    ? raw.files.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const summary = Array.isArray(raw.summary)
    ? raw.summary.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const digest =
    typeof raw.digest === "string" && raw.digest.trim().length > 0 ? raw.digest : undefined;

  if (files.length === 0) {
    return undefined;
  }

  return { files, summary, digest };
}

function readRepoGuide(task: Task): { content: string; digest?: string } | undefined {
  const raw = task.metadata.repoGuide;
  if (!isRecord(raw)) return undefined;

  const content =
    typeof raw.content === "string" && raw.content.trim().length > 0 ? raw.content : undefined;
  if (!content) return undefined;

  const digest =
    typeof raw.digest === "string" && raw.digest.trim().length > 0 ? raw.digest : undefined;

  return { content, digest };
}

function buildTaskPrompt(task: Task): string {
  const fileList = task.targetFiles.length > 0 ? task.targetFiles.join("\n") : "(none provided)";
  const contextAck = readContextAck(task);

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
      task.linkedIssue.labels.length > 0 ? `Labels: ${task.linkedIssue.labels.join(", ")}` : "",
      "",
      "You MUST resolve this GitHub issue with actual code changes:",
      "1. Read the issue description carefully to understand the problem or feature request.",
      "2. Search the codebase to find the relevant files and understand the existing code.",
      "3. Implement the actual fix or feature in code - do NOT just add TODO/FIXME comments.",
      "4. If the issue describes a bug, reproduce it mentally, find the root cause, and fix it.",
      "5. If the issue requests a feature, implement it fully.",
      "6. Run existing tests to ensure nothing breaks. Add tests if appropriate.",
    );
  }

  lines.push(
    "",
    "Description:",
    task.description,
  );

  if (task.targetFiles.length > 0) {
    lines.push(
      "",
      "Target files:",
      fileList,
    );
  } else {
    lines.push(
      "",
      "No target files specified. You MUST search the codebase to find the relevant files.",
      "Use grep, find, or read the project structure to identify which files need changes.",
      "Look at the description and issue details to determine where changes are needed.",
    );
  }

  lines.push(
    "",
    "IMPORTANT RULES:",
    "- You MUST make real, functional code changes. Do NOT just add TODO comments, FIXME comments, or code comments describing what should be done.",
    "- Actually implement the fix or improvement in working code.",
    "- If you are fixing a bug, write the actual fix. If you are adding a feature, write the actual implementation.",
    "- Ensure the repository remains buildable after your changes.",
    "- Run tests if available to verify your changes work.",
  );

  const repoGuide = readRepoGuide(task);
  if (repoGuide) {
    lines.push(
      "",
      "Repository contribution guide (from .oac/README.md — MUST FOLLOW):",
      repoGuide.content,
    );
    if (repoGuide.digest) {
      lines.push("", `Guide digest: ${repoGuide.digest}`);
    }
  }

  if (contextAck) {
    lines.push(
      "",
      "Repository contribution policy (MUST FOLLOW):",
      ...contextAck.files.map((file) => `- ${file}`),
    );

    if (contextAck.summary.length > 0) {
      lines.push("", "Policy summary:", ...contextAck.summary.map((item) => `- ${item}`));
    }

    if (contextAck.digest) {
      lines.push("", `Context digest: ${contextAck.digest}`);
    }

    lines.push(
      "",
      "Treat these policy files as authoritative. Stay within scope and satisfy all Must/Must Not constraints.",
    );
  }

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

  const onEvent = options.onEvent;

  const streamPromise = (async (): Promise<void> => {
    for await (const event of execution.events) {
      if (event.type === "tokens") {
        observedTokens = Math.max(observedTokens, event.cumulativeTokens);
      }

      if (event.type === "file_edit") {
        observedFiles.add(event.path);
      }

      onEvent?.(event);

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
    throw normalizeExecutionError(error, { taskId: task.id, executionId });
  }
}

// ── Epic support ────────────────────────────────────────────

/**
 * Build a context-aware prompt for an entire epic, including all subtasks
 * and module context.
 */
export function buildEpicPrompt(epic: Epic): string {
  const lines = [
    "You are implementing a coherent set of changes as a single epic.",
    `Epic: ${epic.title}`,
    `Scope: ${epic.scope} module`,
    "",
    "Description:",
    epic.description,
    "",
    `Subtasks (${epic.subtasks.length}):`,
  ];

  for (let i = 0; i < epic.subtasks.length; i++) {
    const task = epic.subtasks[i];
    const files = task.targetFiles.length > 0 ? ` [${task.targetFiles.join(", ")}]` : "";
    lines.push(`  ${i + 1}. ${task.title}${files}`);
    if (task.description) {
      lines.push(`     ${task.description}`);
    }
  }

  if (epic.contextFiles.length > 0) {
    lines.push(
      "",
      "Context files to read for understanding:",
      ...epic.contextFiles.map((f) => `  - ${f}`),
    );
  }

  lines.push(
    "",
    "Instructions:",
    "- Apply all changes in a single coherent commit.",
    "- Ensure the repository remains buildable after changes.",
    "- Address all subtasks listed above.",
    "- Make REAL code changes. Do NOT just add TODO/FIXME comments or code comments describing what should be done.",
    "- Actually implement the fixes and improvements in working code.",
    "- Run tests to verify your changes work correctly.",
  );

  return lines.join("\n");
}

/**
 * Convert an Epic into a Task for backward compatibility with executeTask().
 */
export function epicAsTask(epic: Epic): Task {
  const allTargetFiles = [...new Set(epic.subtasks.flatMap((t) => t.targetFiles))];

  return {
    id: epic.id,
    source: epic.subtasks[0]?.source ?? "custom",
    title: epic.title,
    description: buildEpicPrompt(epic),
    targetFiles: allTargetFiles,
    priority: epic.priority,
    complexity:
      epic.subtasks.length >= 7 ? "complex" : epic.subtasks.length >= 4 ? "moderate" : "simple",
    executionMode: "new-pr",
    metadata: { epicId: epic.id, subtaskCount: epic.subtasks.length },
    discoveredAt: epic.createdAt,
    parentEpicId: undefined,
  };
}
