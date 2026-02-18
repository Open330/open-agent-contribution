import { OacError, executionError } from "../core/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export { isRecord, toErrorMessage };

/**
 * Comprehensive error normalizer shared by both the execution engine and
 * the task worker.  Converts arbitrary thrown values into structured
 * OacError instances with the correct error code so that the retry logic
 * in the engine can decide whether an error is transient.
 *
 * Handles: timeout, OOM, network errors, git lock conflicts, abort
 * signals, and a generic fallback.
 */
export function normalizeExecutionError(
  error: unknown,
  context: { jobId?: string; taskId: string; attempt?: number; executionId?: string },
): OacError {
  if (error instanceof OacError) {
    return error;
  }

  const message = toErrorMessage(error);
  const { jobId, taskId, attempt, executionId } = context;
  const ctx: Record<string, unknown> = { taskId };
  if (jobId) ctx.jobId = jobId;
  if (executionId) ctx.executionId = executionId;
  if (attempt !== undefined) ctx.attempt = attempt;
  ctx.message = message;

  if (/timed out|timeout/i.test(message)) {
    return executionError("AGENT_TIMEOUT", `Task ${taskId} timed out during execution.`, {
      context: ctx,
      cause: error,
    });
  }

  if (/out of memory|ENOMEM|heap/i.test(message)) {
    return executionError("AGENT_OOM", `Task ${taskId} ran out of memory.`, {
      context: ctx,
      cause: error,
    });
  }

  if (/network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new OacError(
      `Task ${taskId} failed due to a network error.`,
      "NETWORK_ERROR",
      "recoverable",
      ctx,
      error,
    );
  }

  if (/index\.lock|cannot lock ref|Unable to create '.+?\.git\/index\.lock'/i.test(message)) {
    return new OacError(
      `Task ${taskId} failed due to a git lock conflict.`,
      "GIT_LOCK_FAILED",
      "recoverable",
      ctx,
      error,
    );
  }

  if (isRecord(error) && error.name === "AbortError") {
    return executionError("AGENT_EXECUTION_FAILED", `Task ${taskId} was aborted.`, {
      context: ctx,
      cause: error,
    });
  }

  return executionError("AGENT_EXECUTION_FAILED", `Task ${taskId} failed during execution.`, {
    context: ctx,
    cause: error,
  });
}

