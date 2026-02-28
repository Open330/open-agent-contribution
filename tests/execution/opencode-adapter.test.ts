import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OacError } from "../../src/core/index.js";

import type { AgentEvent, AgentExecuteParams } from "../../src/execution/agents/agent.interface.js";
import { OpenCodeAdapter } from "../../src/execution/agents/opencode.adapter.js";

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
    executionId: "exec-oc-1",
    workingDirectory: "/tmp/workdir",
    prompt: "Fix the issue",
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

describe("OpenCodeAdapter", () => {
  it("has correct id and name", () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.id).toBe("opencode");
    expect(adapter.name).toBe("OpenCode");
  });

  describe("checkAvailability", () => {
    it("returns available with version when opencode CLI is installed", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 0,
            stdout: "opencode 0.2.3\n",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(execa).toHaveBeenCalledWith("opencode", ["--version"], { reject: false });
      expect(result).toEqual({ available: true, version: "0.2.3" });
    });

    it("returns available without version for non-semver output", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 0,
            stdout: "opencode dev\n",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result).toEqual({ available: true, version: undefined });
    });

    it("returns unavailable when exit code is non-zero", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "not found",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("not found");
    });

    it("falls back to stdout for error when stderr is empty", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 1,
            stdout: "some stdout error",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("some stdout error");
    });

    it("uses exit code message when both stdout and stderr are empty", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () =>
          Promise.resolve({
            exitCode: 127,
            stdout: "",
            stderr: "",
          }) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain("127");
    });

    it("returns unavailable on spawn error", async () => {
      vi.mocked(execa).mockImplementationOnce(
        () => Promise.reject(new Error("spawn ENOENT")) as unknown as ReturnType<typeof execa>,
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe("spawn ENOENT");
    });
  });

  describe("execute", () => {
    it("spawns opencode process with correct args", async () => {
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

      const adapter = new OpenCodeAdapter();
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

      expect(execution.providerId).toBe("opencode");
      expect(execa).toHaveBeenCalledWith(
        "opencode",
        ["run", "--format", "json", "Fix all issues"],
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

    it("streams stdout and stderr events", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: ["stdout line"],
          stderrLines: ["stderr line"],
        }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const outputEvents = events.filter(
        (e): e is Extract<AgentEvent, { type: "output" }> => e.type === "output",
      );
      expect(outputEvents).toContainEqual({
        type: "output",
        content: "stdout line",
        stream: "stdout",
      });
      expect(outputEvents).toContainEqual({
        type: "output",
        content: "stderr line",
        stream: "stderr",
      });
    });

    it("parses structured JSON events from stdout", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stdoutLines: [
            JSON.stringify({
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            }),
            JSON.stringify({
              type: "file_edit",
              path: "src/new.ts",
              action: "create",
            }),
            JSON.stringify({
              tool: "grep",
              input: { pattern: "TODO" },
            }),
            JSON.stringify({
              type: "error",
              message: "temporary issue",
              recoverable: true,
            }),
          ],
        }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      const result = await execution.result;
      const events = await eventsPromise;

      expect(events.find((e) => e.type === "tokens")).toEqual({
        type: "tokens",
        inputTokens: 10,
        outputTokens: 5,
        cumulativeTokens: 15,
      });
      expect(events.find((e) => e.type === "file_edit")).toEqual({
        type: "file_edit",
        path: "src/new.ts",
        action: "create",
      });
      expect(events.find((e) => e.type === "tool_use")).toEqual({
        type: "tool_use",
        tool: "grep",
        input: { pattern: "TODO" },
      });
      expect(events.find((e) => e.type === "error")).toEqual({
        type: "error",
        message: "temporary issue",
        recoverable: true,
      });
      expect(result.filesChanged).toContain("src/new.ts");
    });

    it("detects errors from stderr", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          stderrLines: ["Error: connection failed"],
        }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams());
      const eventsPromise = collectEvents(execution.events);
      await execution.result;
      const events = await eventsPromise;

      const errorEvent = events.find(
        (e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error",
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain("connection failed");
    });

    it("returns successful result for exit code 0", async () => {
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

      const adapter = new OpenCodeAdapter();
      const result = await adapter.execute(makeParams()).result;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it("returns failure result for non-zero exit code", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 7, stdout: "out", stderr: "err" },
        }),
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.execute(makeParams()).result;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(7);
      expect(result.error).toBe("err");
    });

    it("uses default failure message when both streams are empty", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 1, stdout: "", stderr: "" },
        }),
      );

      const adapter = new OpenCodeAdapter();
      const result = await adapter.execute(makeParams()).result;

      expect(result.error).toBe("OpenCode CLI process exited with a non-zero status.");
    });

    it("handles timeout", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({
          settled: { exitCode: 124, timedOut: true },
        }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-timeout" }));
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

      const adapter = new OpenCodeAdapter();
      const result = await adapter.execute(makeParams()).result;

      expect(result.success).toBe(false);
      expect(result.error).toBe("OpenCode execution was cancelled.");
    });

    it("normalizes timeout errors from exceptions", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("operation timed out") }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-err" }));

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
    });

    it("normalizes OOM errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("ENOMEM") }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-oom" }));

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_OOM" });
    });

    it("normalizes rate limit errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("rate limit exceeded") }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-rate" }));

      await expect(execution.result).rejects.toMatchObject({ code: "AGENT_RATE_LIMITED" });
    });

    it("normalizes network errors", async () => {
      vi.mocked(execa).mockReturnValueOnce(
        createMockSubprocess({ rejectWith: new Error("ECONNREFUSED") }),
      );

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-net" }));

      await expect(execution.result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("passes through OacError unchanged", async () => {
      const oce = new OacError("already oac", "AGENT_EXECUTION_FAILED", "fatal");
      vi.mocked(execa).mockReturnValueOnce(createMockSubprocess({ rejectWith: oce }));

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-oac" }));

      await expect(execution.result).rejects.toBe(oce);
    });
  });

  describe("estimateTokens", () => {
    it("returns estimates with correct shape", async () => {
      const adapter = new OpenCodeAdapter();
      const estimate = await adapter.estimateTokens({
        taskId: "task-oc-est",
        prompt: "Fix lint",
        targetFiles: ["src/file.ts"],
      });

      expect(estimate.taskId).toBe("task-oc-est");
      expect(estimate.providerId).toBe("opencode");
      expect(estimate.confidence).toBe(0.5);
      expect(estimate.feasible).toBe(true);
      expect(estimate.totalEstimatedTokens).toBe(
        estimate.contextTokens + estimate.promptTokens + estimate.expectedOutputTokens,
      );
    });

    it("returns feasible for small tasks", async () => {
      const directory = await mkdtemp(join(tmpdir(), "oac-opencode-small-"));
      const filePath = join(directory, "small.ts");
      await writeFile(filePath, "const ok = true;\n");

      const adapter = new OpenCodeAdapter();
      const estimate = await adapter.estimateTokens({
        taskId: "task-oc-small",
        prompt: "Fix lint",
        targetFiles: [filePath],
      });

      expect(estimate.feasible).toBe(true);
      expect(estimate.totalEstimatedTokens).toBeLessThan(200_000);
    });

    it("returns infeasible for huge tasks", async () => {
      const adapter = new OpenCodeAdapter();
      const targetFiles = Array.from({ length: 120 }, (_, i) => `/tmp/huge-${i}.ts`);

      const estimate = await adapter.estimateTokens({
        taskId: "task-oc-huge",
        prompt: "x",
        targetFiles,
      });

      expect(estimate.feasible).toBe(false);
      expect(estimate.totalEstimatedTokens).toBeGreaterThan(200_000);
    });
  });

  describe("abort", () => {
    it("kills running process", async () => {
      const pending = createPendingSubprocess();
      vi.mocked(execa).mockReturnValueOnce(pending.subprocess);

      const adapter = new OpenCodeAdapter();
      const execution = adapter.execute(makeParams({ executionId: "exec-oc-abort" }));
      const resultPromise = execution.result.catch((e) => e);

      await adapter.abort("exec-oc-abort");
      const failure = await resultPromise;

      expect(pending.kill).toHaveBeenCalledWith("SIGTERM");
      expect(failure).toBeInstanceOf(OacError);
    });

    it("ignores unknown execution ids", async () => {
      const adapter = new OpenCodeAdapter();
      await expect(adapter.abort("missing")).resolves.toBeUndefined();
    });
  });
});
