import { Readable } from "node:stream";

import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OacError } from "../../src/core/index.js";

import type { AgentEvent, AgentExecuteParams } from "../../src/execution/agents/agent.interface.js";
import { ClaudeCodeAdapter } from "../../src/execution/agents/claude-code.adapter.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

interface MockSettledResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  isCanceled?: boolean;
}

interface MockSubprocessOptions {
  pid?: number;
  stdoutLines?: string[];
  stderrLines?: string[];
  settled?: Partial<MockSettledResult>;
  rejectWith?: unknown;
}

function makeParams(overrides: Partial<AgentExecuteParams> = {}): AgentExecuteParams {
  return {
    executionId: "exec-cc-1",
    workingDirectory: "/tmp/workdir",
    prompt: "Fix the bug",
    targetFiles: ["src/file.ts"],
    tokenBudget: 5_000,
    allowCommits: false,
    timeoutMs: 30_000,
    env: { TEST_ENV: "1" },
    ...overrides,
  };
}

function toReadable(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`));
}

function createMockSubprocess(options: MockSubprocessOptions = {}): ReturnType<typeof execa> {
  const kill = vi.fn().mockReturnValue(true);
  const settled: MockSettledResult = {
    exitCode: 0,
    stdout: "",
    stderr: "",
    ...options.settled,
  };

  const promise =
    options.rejectWith === undefined
      ? Promise.resolve(settled)
      : Promise.reject(options.rejectWith);

  return Object.assign(promise, {
    stdout: toReadable(options.stdoutLines ?? []),
    stderr: toReadable(options.stderrLines ?? []),
    pid: options.pid ?? 1234,
    kill,
  }) as unknown as ReturnType<typeof execa>;
}

function createPendingSubprocess() {
  let resolvePromise: ((value: MockSettledResult) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;

  const pendingPromise = new Promise<MockSettledResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const kill = vi.fn((signal: string) => {
    if (signal === "SIGTERM") {
      rejectPromise?.(new Error("terminated"));
    }
    return true;
  });

  if (!resolvePromise || !rejectPromise) {
    throw new Error("Failed to create pending subprocess");
  }

  const subprocess = Object.assign(pendingPromise, {
    stdout: toReadable([]),
    stderr: toReadable([]),
    pid: 9001,
    kill,
  }) as unknown as ReturnType<typeof execa>;

  return { subprocess, kill, resolve: resolvePromise, reject: rejectPromise };
}

async function collectEvents(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function collectEventsSafe(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  try {
    for await (const event of events) {
      collected.push(event);
    }
  } catch {}
  return collected;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClaudeCodeAdapter", () => {
  it("has correct id and name", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.id).toBe("claude-code");
    expect(adapter.name).toBe("Claude Code");
  });

  describe("checkAvailability", () => {
    it("returns available with version when claude CLI is installed", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 0,
            stdout: "1.5.2\n",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new ClaudeCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(execa).toHaveBeenCalledWith("claude", ["--version"], {
        reject: false,
        stdin: "ignore",
      });
      expect(result).toEqual({ available: true, version: "1.5.2" });
    });

    it("returns available without version for empty stdout", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 0,
            stdout: "",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new ClaudeCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result).toEqual({ available: true, version: undefined });
    });

    it("returns unavailable when exit code is non-zero", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "command not found",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new ClaudeCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("command not found");
    });

    it("returns unavailable on spawn error", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () => Promise.reject(new Error("spawn ENOENT")) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new ClaudeCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("spawn ENOENT");
    });
  });

  describe("execute", () => {
    it("spawns claude process with correct args", async () => {
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

      const adapter = new ClaudeCodeAdapter();
      const params = makeParams({
        prompt: "Fix all issues",
        workingDirectory: "/tmp/project",
        tokenBudget: 7_777,
        allowCommits: true,
        timeoutMs: 10_000,
        env: { CUSTOM_ENV: "abc" },
      });

      const execution = adapter.execute(params);
      await execution.result;

      expect(execution.providerId).toBe("claude-code");
      expect(execa).toHaveBeenCalledWith(
        "claude",
        [
          "-p",
          "--dangerously-skip-permissions",
          "--verbose",
          "--output-format",
          "stream-json",
          "Fix all issues",
        ],
        expect.objectContaining({
          cwd: "/tmp/project",
          reject: false,
          timeout: 10_000,
          stdin: "ignore",
          env: expect.objectContaining({
            CUSTOM_ENV: "abc",
            OAC_TOKEN_BUDGET: "7777",
            OAC_ALLOW_COMMITS: "true",
          }),
        }),
      );
    });

    it("strips CLAUDECODE and CLAUDE_CODE_SESSION from env", async () => {
      const origClaudeCode = process.env.CLAUDECODE;
      const origSession = process.env.CLAUDE_CODE_SESSION;
      process.env.CLAUDECODE = "1";
      process.env.CLAUDE_CODE_SESSION = "session-123";

      try {
        vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

        const adapter = new ClaudeCodeAdapter();
        const execution = adapter.execute(makeParams());
        await execution.result;

        const callArgs = vi.mocked(execa).mock.calls[0];
        const env = (callArgs[2] as { env: Record<string, string> }).env;
        expect(env).not.toHaveProperty("CLAUDECODE");
        expect(env).not.toHaveProperty("CLAUDE_CODE_SESSION");
      } finally {
        if (origClaudeCode === undefined) process.env.CLAUDECODE = undefined;
        else process.env.CLAUDECODE = origClaudeCode;
        if (origSession === undefined) process.env.CLAUDE_CODE_SESSION = undefined;
        else process.env.CLAUDE_CODE_SESSION = origSession;
      }
    });

    it("streams stdout and stderr events", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: ["stdout line 1"],
          stderrLines: ["stderr line 1"],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const outputEvents = events.filter(
        (e): e is Extract<AgentEvent, { type: "output" }> => e.type === "output",
      );
      expect(outputEvents).toContainEqual({
        type: "output",
        content: "stdout line 1",
        stream: "stdout",
      });
      expect(outputEvents).toContainEqual({
        type: "output",
        content: "stderr line 1",
        stream: "stderr",
      });
    });

    it("parses token events from JSON payload", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({
              message: { usage: { input_tokens: 100, output_tokens: 50 } },
            }),
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const tokenEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "tokens" }> => e.type === "tokens",
      );
      expect(tokenEvent).toEqual({
        type: "tokens",
        inputTokens: 100,
        outputTokens: 50,
        cumulativeTokens: 150,
      });
    });

    it("parses token events with cache tokens", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 30,
                cache_creation_input_tokens: 20,
              },
            }),
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const tokenEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "tokens" }> => e.type === "tokens",
      );
      // effective input = 100 + 30 + 20 = 150
      expect(tokenEvent?.inputTokens).toBe(150);
      expect(tokenEvent?.outputTokens).toBe(50);
    });

    it("parses token events from text lines (fallback)", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: ["input tokens: 200, output tokens: 80, total tokens: 280"],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const tokenEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "tokens" }> => e.type === "tokens",
      );
      expect(tokenEvent).toEqual({
        type: "tokens",
        inputTokens: 200,
        outputTokens: 80,
        cumulativeTokens: 280,
      });
    });

    it("parses file_edit events from JSON", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({ type: "file_edit", path: "src/foo.ts", action: "create" }),
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      const result = await execution.result;
      const events = await eventsPromise;

      const fileEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "file_edit" }> => e.type === "file_edit",
      );
      expect(fileEvent).toEqual({ type: "file_edit", path: "src/foo.ts", action: "create" });
      expect(result.filesChanged).toContain("src/foo.ts");
    });

    it("parses file_edit events from tool use payloads", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({ tool: "write_file", input: { path: "src/bar.ts" } }),
            JSON.stringify({ tool: "create_file", input: { path: "src/new.ts" } }),
            JSON.stringify({ tool: "delete_file", input: { file_path: "src/old.ts" } }),
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const fileEvents = events.filter(
        (e): e is Extract<AgentEvent, { type: "file_edit" }> => e.type === "file_edit",
      );
      expect(fileEvents).toContainEqual({
        type: "file_edit",
        action: "modify",
        path: "src/bar.ts",
      });
      expect(fileEvents).toContainEqual({
        type: "file_edit",
        action: "create",
        path: "src/new.ts",
      });
      expect(fileEvents).toContainEqual({
        type: "file_edit",
        action: "delete",
        path: "src/old.ts",
      });
    });

    it("parses file_edit from text lines (fallback)", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: ["Created file src/created.ts"],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const fileEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "file_edit" }> => e.type === "file_edit",
      );
      expect(fileEvent).toEqual({ type: "file_edit", action: "create", path: "src/created.ts" });
    });

    it("parses tool_use events from JSON", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [JSON.stringify({ tool: "rg", input: { pattern: "TODO" } })],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const toolEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "tool_use" }> => e.type === "tool_use",
      );
      expect(toolEvent).toEqual({ type: "tool_use", tool: "rg", input: { pattern: "TODO" } });
    });

    it("parses error events from JSON", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({ type: "error", message: "rate limited", recoverable: true }),
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const errorEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error",
      );
      expect(errorEvent).toEqual({ type: "error", message: "rate limited", recoverable: true });
    });

    it("parses error events from stderr", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stderrLines: ["Error: something failed badly"],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const errorEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error",
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain("something failed badly");
      expect(errorEvent?.recoverable).toBe(true);
    });

    it("handles non-recoverable error event", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [JSON.stringify({ type: "error", message: "fatal", recoverable: false })],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const errorEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error",
      );
      expect(errorEvent?.recoverable).toBe(false);
    });

    it("returns successful result for exit code 0", async () => {
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
      expect(typeof result.duration).toBe("number");
    });

    it("returns failure result for non-zero exit code", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 1, stdout: "some output", stderr: "some error" },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe("some error");
    });

    it("uses stdout as failure message when stderr is empty", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 1, stdout: "stdout failure", stderr: "" },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.error).toBe("stdout failure");
    });

    it("uses default failure message when both stdout and stderr are empty", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 1, stdout: "", stderr: "" },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.error).toBe("Claude CLI process exited with a non-zero status.");
    });

    it("normalizes non-numeric exit codes to 1", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: null as unknown as number, stdout: "", stderr: "" },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.exitCode).toBe(1);
    });

    it("handles timeout", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 124, timedOut: true },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-timeout" }));
      const eventsPromise = collectEventsSafe(execution.events);

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });

      const events = await eventsPromise;
      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("handles cancellation", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 130, isCanceled: true },
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const result = await execution.result;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Claude execution was cancelled.");
    });

    it("normalizes unknown thrown errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("something timed out") }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-err" }));

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
    });

    it("normalizes network errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("ECONNREFUSED") }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-net" }));

      await expect(execution.result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("normalizes OOM errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("JavaScript heap out of memory") }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oom" }));

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_OOM" });
    });

    it("passes through OacError unchanged", async () => {
      const oce = new OacError("already oac", "AGENT_EXECUTION_FAILED", "fatal");
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess({ rejectWith: oce }));

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oac" }));

      await expect(execution.result).rejects.toBe(oce);
    });

    it("ignores non-JSON and non-matching text lines gracefully", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: ["plain text with no relevant patterns", "not valid json {", ""],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      // Should only have output events, no token/file/tool/error events
      const nonOutput = events.filter((e) => e.type !== "output");
      expect(nonOutput).toHaveLength(0);
    });

    it("parses JSON embedded in non-JSON text", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            `prefix text {"type":"file_edit","path":"src/x.ts","action":"modify"} suffix`,
          ],
        }),
      );

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const fileEvent = events.find((e) => e.type === "file_edit");
      expect(fileEvent).toBeDefined();
    });
  });

  describe("estimateTokens", () => {
    it("returns estimates with correct shape", async () => {
      const adapter = new ClaudeCodeAdapter();
      const estimate = await adapter.estimateTokens({
        taskId: "task-est",
        prompt: "Fix lint warning in file.ts",
        targetFiles: ["src/file.ts"],
      });

      expect(estimate.taskId).toBe("task-est");
      expect(estimate.providerId).toBe("claude-code");
      expect(estimate.confidence).toBe(0.6);
      expect(estimate.feasible).toBe(true);
      expect(estimate.contextTokens).toBeGreaterThan(0);
      expect(estimate.promptTokens).toBeGreaterThan(0);
      expect(estimate.expectedOutputTokens).toBeGreaterThan(0);
      expect(estimate.totalEstimatedTokens).toBe(
        estimate.contextTokens + estimate.promptTokens + estimate.expectedOutputTokens,
      );
    });

    it("uses provided contextTokens and expectedOutputTokens", async () => {
      const adapter = new ClaudeCodeAdapter();
      const estimate = await adapter.estimateTokens({
        taskId: "task-custom",
        prompt: "Do something",
        targetFiles: [],
        contextTokens: 500,
        expectedOutputTokens: 1_000,
      });

      expect(estimate.contextTokens).toBe(500);
      expect(estimate.expectedOutputTokens).toBe(1_000);
    });
  });

  describe("abort", () => {
    it("kills running process with SIGTERM", async () => {
      const pending = createPendingSubprocess();
      vi.mocked(execa).mockReturnValueOnce(pending.subprocess);

      const adapter = new ClaudeCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-abort" }));
      const resultPromise = execution.result.catch((e) => e);

      await adapter.abort("exec-abort");
      await resultPromise;

      expect(pending.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("ignores unknown execution ids", async () => {
      const adapter = new ClaudeCodeAdapter();
      await expect(adapter.abort("missing")).resolves.toBeUndefined();
    });
  });
});
