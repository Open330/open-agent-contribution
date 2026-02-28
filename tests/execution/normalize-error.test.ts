import { describe, expect, it } from "vitest";

import { OacError, executionError } from "../../src/core/index.js";
import { normalizeExecutionError, toErrorMessage } from "../../src/execution/normalize-error.js";

describe("toErrorMessage", () => {
  it("returns message from Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("converts non-Error values to strings", () => {
    expect(toErrorMessage("string error")).toBe("string error");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("uses message from OacError instances", () => {
    const err = new OacError("oac message", "AGENT_EXECUTION_FAILED", "fatal");
    expect(toErrorMessage(err)).toBe("oac message");
  });
});

describe("normalizeExecutionError", () => {
  const ctx = { taskId: "task-1" };

  it("returns OacError as-is when already an OacError", () => {
    const original = executionError("AGENT_EXECUTION_FAILED", "already oac");
    const result = normalizeExecutionError(original, ctx);
    expect(result).toBe(original);
  });

  it("detects timeout errors", () => {
    const result = normalizeExecutionError(new Error("operation timed out"), ctx);
    expect(result).toBeInstanceOf(OacError);
    expect(result.code).toBe("AGENT_TIMEOUT");
    expect(result.message).toContain("task-1");
    expect(result.message).toContain("timed out");
  });

  it("detects timeout with mixed case", () => {
    const result = normalizeExecutionError(new Error("Request Timeout"), ctx);
    expect(result.code).toBe("AGENT_TIMEOUT");
  });

  it("detects OOM errors", () => {
    const result = normalizeExecutionError(new Error("JavaScript heap out of memory"), ctx);
    expect(result.code).toBe("AGENT_OOM");
    expect(result.message).toContain("task-1");
  });

  it("detects ENOMEM errors", () => {
    const result = normalizeExecutionError(new Error("ENOMEM: not enough memory"), ctx);
    expect(result.code).toBe("AGENT_OOM");
  });

  it("detects network errors (ECONN)", () => {
    const result = normalizeExecutionError(new Error("ECONNREFUSED"), ctx);
    expect(result.code).toBe("NETWORK_ERROR");
    expect(result.severity).toBe("recoverable");
  });

  it("detects network errors (ENOTFOUND)", () => {
    const result = normalizeExecutionError(new Error("ENOTFOUND: dns lookup failed"), ctx);
    expect(result.code).toBe("NETWORK_ERROR");
  });

  it("detects network errors (EAI_AGAIN)", () => {
    const result = normalizeExecutionError(new Error("EAI_AGAIN"), ctx);
    expect(result.code).toBe("NETWORK_ERROR");
  });

  it("detects generic network keyword", () => {
    const result = normalizeExecutionError(new Error("network unreachable"), ctx);
    expect(result.code).toBe("NETWORK_ERROR");
  });

  it("detects git lock conflicts (index.lock)", () => {
    const result = normalizeExecutionError(
      new Error("fatal: Unable to create '.git/index.lock'"),
      ctx,
    );
    expect(result.code).toBe("GIT_LOCK_FAILED");
    expect(result.severity).toBe("recoverable");
  });

  it("detects git lock conflicts (cannot lock ref)", () => {
    const result = normalizeExecutionError(new Error("cannot lock ref 'refs/heads/main'"), ctx);
    expect(result.code).toBe("GIT_LOCK_FAILED");
  });

  it("detects AbortError by name property", () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const result = normalizeExecutionError(abortError, ctx);
    expect(result.code).toBe("AGENT_EXECUTION_FAILED");
    expect(result.message).toContain("aborted");
  });

  it("falls back to AGENT_EXECUTION_FAILED for unknown errors", () => {
    const result = normalizeExecutionError(new Error("something went wrong"), ctx);
    expect(result.code).toBe("AGENT_EXECUTION_FAILED");
    expect(result.message).toContain("task-1");
  });

  it("handles non-Error thrown values", () => {
    const result = normalizeExecutionError("string error", ctx);
    expect(result.code).toBe("AGENT_EXECUTION_FAILED");
    expect(result).toBeInstanceOf(OacError);
  });

  it("includes context fields in the error", () => {
    const fullCtx = { taskId: "task-2", jobId: "job-1", attempt: 3, executionId: "exec-1" };
    const result = normalizeExecutionError(new Error("fail"), fullCtx);
    expect(result.context).toMatchObject({
      taskId: "task-2",
      jobId: "job-1",
      attempt: 3,
      executionId: "exec-1",
    });
  });

  it("omits undefined optional context fields", () => {
    const result = normalizeExecutionError(new Error("fail"), { taskId: "task-3" });
    expect(result.context).toHaveProperty("taskId", "task-3");
    expect(result.context).not.toHaveProperty("jobId");
    expect(result.context).not.toHaveProperty("executionId");
    expect(result.context).not.toHaveProperty("attempt");
  });

  it("preserves the original error as cause", () => {
    const original = new Error("root cause");
    const result = normalizeExecutionError(original, ctx);
    expect(result.cause).toBe(original);
  });
});
