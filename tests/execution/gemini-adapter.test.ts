import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent, AgentExecuteParams } from "../../src/execution/agents/agent.interface.js";
import { GeminiAdapter } from "../../src/execution/agents/gemini.adapter.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

interface MockProcessOptions {
  pid?: number;
  stdoutLines?: string[];
  stderrLines?: string[];
  closeCode?: number | null;
  closeSignal?: NodeJS.Signals | null;
  emitError?: unknown;
  autoClose?: boolean;
}

interface PendingProcess {
  process: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
  close: (exitCode?: number | null, signal?: NodeJS.Signals | null) => void;
  fail: (error: unknown) => void;
}

function makeParams(overrides: Partial<AgentExecuteParams> = {}): AgentExecuteParams {
  return {
    executionId: "execution-1",
    workingDirectory: "/tmp/workdir",
    prompt: "Fix lint issues",
    targetFiles: ["src/file.ts"],
    tokenBudget: 5_000,
    allowCommits: false,
    timeoutMs: 30_000,
    env: {
      TEST_ENV: "1",
    },
    ...overrides,
  };
}

function toReadable(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`));
}

function createMockProcess(options: MockProcessOptions = {}): ChildProcessWithoutNullStreams {
  const proc = new EventEmitter() as ChildProcessWithoutNullStreams;

  const kill = vi.fn().mockReturnValue(true);
  const stdoutStream = toReadable(options.stdoutLines ?? []);
  const stderrStream = toReadable(options.stderrLines ?? []);

  Object.assign(proc as object, {
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: options.pid ?? 1234,
    kill,
    exitCode: null,
    signalCode: null,
  });

  if (options.autoClose !== false) {
    if (options.emitError !== undefined) {
      setImmediate(() => {
        proc.emit("error", options.emitError);
      });
    } else {
      // Wait for both streams to end before emitting "close" to match
      // real child_process behavior (close fires after stdio streams close).
      let streamsEnded = 0;
      const onStreamEnd = (): void => {
        streamsEnded++;
        if (streamsEnded >= 2) {
          (proc as { exitCode: number | null }).exitCode = options.closeCode ?? 0;
          (proc as { signalCode: NodeJS.Signals | null }).signalCode = options.closeSignal ?? null;
          proc.emit("close", options.closeCode ?? 0, options.closeSignal ?? null);
        }
      };
      stdoutStream.once("end", onStreamEnd);
      stderrStream.once("end", onStreamEnd);
    }
  }

  return proc;
}

function createPendingProcess(): PendingProcess {
  const process = createMockProcess({
    stdoutLines: [],
    stderrLines: [],
    autoClose: false,
    pid: 9001,
  });

  const kill = vi.fn((signal: NodeJS.Signals) => {
    if (signal === "SIGTERM") {
      setImmediate(() => {
        (process as { exitCode: number | null }).exitCode = null;
        (process as { signalCode: NodeJS.Signals | null }).signalCode = "SIGTERM";
        process.emit("close", null, "SIGTERM");
      });
    }
    return true;
  });

  (process as { kill: ReturnType<typeof vi.fn> }).kill = kill;

  return {
    process,
    kill,
    close: (exitCode = 0, signal = null) => {
      (process as { exitCode: number | null }).exitCode = exitCode;
      (process as { signalCode: NodeJS.Signals | null }).signalCode = signal;
      process.emit("close", exitCode, signal);
    },
    fail: (error) => {
      process.emit("error", error);
    },
  };
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

function isOutputEvent(event: AgentEvent): event is Extract<AgentEvent, { type: "output" }> {
  return event.type === "output";
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GeminiAdapter", () => {
  it("checkAvailability returns version when gemini is installed", async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      createMockProcess({
        stdoutLines: ["gemini 1.2.3"],
        closeCode: 0,
      }) as unknown as ReturnType<typeof spawn>,
    );

    const adapter = new GeminiAdapter();
    const availability = await adapter.checkAvailability();

    expect(spawn).toHaveBeenCalledWith("gemini", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(availability).toEqual({
      available: true,
      version: "1.2.3",
    });
  });

  it("checkAvailability returns unavailable when gemini is not found", async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(
        createMockProcess({
          stderrLines: ["spawn gemini ENOENT"],
          closeCode: 1,
        }) as unknown as ReturnType<typeof spawn>,
      )
      .mockReturnValueOnce(
        createMockProcess({
          stderrLines: ["which: no gemini"],
          closeCode: 1,
        }) as unknown as ReturnType<typeof spawn>,
      );

    const adapter = new GeminiAdapter();
    const availability = await adapter.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.error).toBe("spawn gemini ENOENT");
  });

  it("execute spawns gemini process with correct args", async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      createMockProcess() as unknown as ReturnType<typeof spawn>,
    );

    const adapter = new GeminiAdapter();
    const params = makeParams({
      prompt: "Fix all issues",
      workingDirectory: "/tmp/project",
      tokenBudget: 7_777,
      allowCommits: true,
      timeoutMs: 10_000,
      env: {
        CUSTOM_ENV: "abc",
      },
    });

    const execution = adapter.execute(params);
    await execution.result;

    expect(execution.providerId).toBe("gemini");
    expect(spawn).toHaveBeenCalledWith(
      "gemini",
      ["-p", "Fix all issues", "--yolo", "-o", "text"],
      expect.objectContaining({
        cwd: "/tmp/project",
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.objectContaining({
          CUSTOM_ENV: "abc",
          OAC_TOKEN_BUDGET: "7777",
          OAC_ALLOW_COMMITS: "true",
        }),
      }),
    );
  });

  it("execute streams stdout events", async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      createMockProcess({
        stdoutLines: ["first line", "second line"],
      }) as unknown as ReturnType<typeof spawn>,
    );

    const adapter = new GeminiAdapter();
    const execution = adapter.execute(makeParams());
    const eventsPromise = collectEvents(execution.events);
    await execution.result;
    const events = await eventsPromise;

    const stdoutLines = events
      .filter(isOutputEvent)
      .filter((event) => event.stream === "stdout")
      .map((event) => event.content);

    expect(stdoutLines).toEqual(["first line", "second line"]);
  });

  it("execute parses structured JSON events from stdout", async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      createMockProcess({
        stdoutLines: [
          JSON.stringify({
            usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
          }),
          JSON.stringify({
            type: "file_edit",
            path: "src/new-file.ts",
            action: "create",
          }),
          JSON.stringify({
            type: "tool_use",
            tool: "rg",
            input: { pattern: "TODO" },
          }),
          JSON.stringify({
            type: "error",
            message: "temporary warning",
            recoverable: true,
          }),
        ],
      }) as unknown as ReturnType<typeof spawn>,
    );

    const adapter = new GeminiAdapter();
    const execution = adapter.execute(makeParams());
    const eventsPromise = collectEvents(execution.events);
    const result = await execution.result;
    const events = await eventsPromise;

    const tokenEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "tokens" }> => event.type === "tokens",
    );
    const fileEditEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "file_edit" }> => event.type === "file_edit",
    );
    const toolUseEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "tool_use" }> => event.type === "tool_use",
    );
    const errorEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error",
    );

    expect(tokenEvent).toEqual({
      type: "tokens",
      inputTokens: 12,
      outputTokens: 5,
      cumulativeTokens: 17,
    });
    expect(fileEditEvent).toEqual({
      type: "file_edit",
      path: "src/new-file.ts",
      action: "create",
    });
    expect(toolUseEvent).toEqual({
      type: "tool_use",
      tool: "rg",
      input: { pattern: "TODO" },
    });
    expect(errorEvent).toEqual({
      type: "error",
      message: "temporary warning",
      recoverable: true,
    });
    expect(result.filesChanged).toEqual(["src/new-file.ts"]);
    expect(result.totalTokensUsed).toBe(17);
  });

  it("execute handles process exit", async () => {
    vi.mocked(spawn).mockReturnValueOnce(
      createMockProcess({
        stderrLines: ["stderr failure"],
        closeCode: 7,
      }) as unknown as ReturnType<typeof spawn>,
    );

    const adapter = new GeminiAdapter();
    const execution = adapter.execute(makeParams());
    const result = await execution.result;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.error).toBe("stderr failure");
  });

  it("execute handles timeout", async () => {
    vi.useFakeTimers();

    try {
      const pending = createPendingProcess();
      vi.mocked(spawn).mockReturnValueOnce(pending.process as unknown as ReturnType<typeof spawn>);

      const adapter = new GeminiAdapter();
      const execution = adapter.execute(
        makeParams({ executionId: "execution-timeout", timeoutMs: 10 }),
      );
      const eventsPromise = collectEventsSafe(execution.events);
      const resultPromise = execution.result.catch((error) => error);

      await vi.advanceTimersByTimeAsync(20);

      const failure = await resultPromise;
      expect(failure).toMatchObject({
        code: "AGENT_TIMEOUT",
      });

      const events = await eventsPromise;
      const hasErrorEvent = events.some((event) => event.type === "error");
      expect(hasErrorEvent).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abort kills running process", async () => {
    const pending = createPendingProcess();
    vi.mocked(spawn).mockReturnValueOnce(pending.process as unknown as ReturnType<typeof spawn>);

    const adapter = new GeminiAdapter();
    const execution = adapter.execute(makeParams({ executionId: "execution-abort" }));

    await adapter.abort("execution-abort");
    const result = await execution.result;

    expect(pending.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Gemini execution was cancelled.");
  });

  it("abort ignores unknown execution ids", async () => {
    const adapter = new GeminiAdapter();

    await expect(adapter.abort("missing")).resolves.toBeUndefined();
  });

  it("estimateTokens returns feasible for small tasks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oac-gemini-small-"));
    const filePath = join(directory, "small.ts");
    await writeFile(filePath, "const ok = true;\n");

    const adapter = new GeminiAdapter();
    const estimate = await adapter.estimateTokens({
      taskId: "task-small",
      prompt: "Fix lint warning",
      targetFiles: [filePath],
    });

    expect(estimate.providerId).toBe("gemini");
    expect(estimate.feasible).toBe(true);
    expect(estimate.totalEstimatedTokens).toBeLessThan(1_000_000);
  });

  it("estimateTokens returns infeasible for huge tasks", async () => {
    const adapter = new GeminiAdapter();
    const targetFiles = Array.from({ length: 600 }, (_, index) => `/tmp/huge-${index}.ts`);

    const estimate = await adapter.estimateTokens({
      taskId: "task-huge",
      prompt: "x",
      targetFiles,
    });

    expect(estimate.feasible).toBe(false);
    expect(estimate.totalEstimatedTokens).toBeGreaterThan(1_000_000);
  });
});
