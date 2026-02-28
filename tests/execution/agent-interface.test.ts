import { describe, expect, it } from "vitest";

import type {
  AgentAvailability,
  AgentEvent,
  AgentExecution,
  AgentExecuteParams,
  AgentProvider,
  AgentResult,
  TokenEstimateParams,
} from "../../src/execution/agents/agent.interface.js";

describe("agent.interface types", () => {
  it("AgentEvent union covers all expected event types", () => {
    const outputEvent: AgentEvent = {
      type: "output",
      content: "hello",
      stream: "stdout",
    };
    const tokenEvent: AgentEvent = {
      type: "tokens",
      inputTokens: 10,
      outputTokens: 5,
      cumulativeTokens: 15,
    };
    const fileEditEvent: AgentEvent = {
      type: "file_edit",
      path: "src/file.ts",
      action: "modify",
    };
    const toolUseEvent: AgentEvent = {
      type: "tool_use",
      tool: "rg",
      input: { pattern: "TODO" },
    };
    const errorEvent: AgentEvent = {
      type: "error",
      message: "something failed",
      recoverable: true,
    };

    expect(outputEvent.type).toBe("output");
    expect(tokenEvent.type).toBe("tokens");
    expect(fileEditEvent.type).toBe("file_edit");
    expect(toolUseEvent.type).toBe("tool_use");
    expect(errorEvent.type).toBe("error");
  });

  it("AgentExecuteParams shape is assignable", () => {
    const params: AgentExecuteParams = {
      executionId: "exec-1",
      workingDirectory: "/tmp",
      prompt: "Fix bug",
      targetFiles: ["a.ts"],
      tokenBudget: 10_000,
      allowCommits: false,
      timeoutMs: 30_000,
    };

    expect(params.executionId).toBe("exec-1");
    expect(params.env).toBeUndefined();
  });

  it("AgentExecuteParams accepts optional env", () => {
    const params: AgentExecuteParams = {
      executionId: "exec-2",
      workingDirectory: "/tmp",
      prompt: "Fix bug",
      targetFiles: [],
      tokenBudget: 5_000,
      allowCommits: true,
      timeoutMs: 10_000,
      env: { MY_VAR: "value" },
    };

    expect(params.env).toEqual({ MY_VAR: "value" });
  });

  it("AgentAvailability represents available state", () => {
    const available: AgentAvailability = { available: true, version: "1.0.0" };
    const unavailable: AgentAvailability = { available: false, error: "not found" };

    expect(available.available).toBe(true);
    expect(unavailable.available).toBe(false);
    expect(unavailable.error).toBe("not found");
  });

  it("TokenEstimateParams accepts optional fields", () => {
    const params: TokenEstimateParams = {
      taskId: "task-1",
      prompt: "Fix lint",
      targetFiles: ["a.ts"],
      contextTokens: 100,
      expectedOutputTokens: 200,
    };

    expect(params.contextTokens).toBe(100);
    expect(params.expectedOutputTokens).toBe(200);
  });
});
