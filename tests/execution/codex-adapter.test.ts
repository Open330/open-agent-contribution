import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OacError } from "../../src/core/index.js";

import type { AgentEvent, AgentExecuteParams } from "../../src/execution/agents/agent.interface.js";
import { CodexAdapter } from "../../src/execution/agents/codex.adapter.js";

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

interface PendingSubprocess {
  subprocess: ReturnType<typeof execa>;
  kill: ReturnType<typeof vi.fn>;
  resolve: (value: MockSettledResult) => void;
  reject: (reason?: unknown) => void;
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

function createPendingSubprocess(): PendingSubprocess {
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

  return {
    subprocess,
    kill,
    resolve: resolvePromise,
    reject: rejectPromise,
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
  vi.clearAllMocks();
});

describe("CodexAdapter", () => {
  it("checkAvailability returns version when codex is installed", async () => {
    vi.mocked(execa).mockImplementationOnce(
      () =>
        Promise.resolve({
          exitCode: 0,
          stdout: "codex 1.2.3\n",
          stderr: "",
        }) as unknown as ReturnType<typeof execa>,
    );

    const adapter = new CodexAdapter();
    const availability = await adapter.checkAvailability();

    expect(execa).toHaveBeenCalledWith("npx", ["--yes", "@openai/codex", "--version"], {
      reject: false,
      timeout: 15_000,
      stdin: "ignore",
    });
    expect(availability).toEqual({
      available: true,
      version: "1.2.3",
    });
  });

  it("checkAvailability falls back to which npx when --version fails", async () => {
    // First call: npx @openai/codex --version fails
    vi.mocked(execa).mockImplementationOnce(
      () =>
        Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
        }) as unknown as ReturnType<typeof execa>,
    );
    // Second call: which npx succeeds
    vi.mocked(execa).mockImplementationOnce(
      () =>
        Promise.resolve({
          exitCode: 0,
          stdout: "/usr/local/bin/npx\n",
          stderr: "",
        }) as unknown as ReturnType<typeof execa>,
    );

    const adapter = new CodexAdapter();
    const availability = await adapter.checkAvailability();

    expect(availability).toEqual({
      available: true,
      version: undefined,
    });
  });

  it("checkAvailability returns unavailable when codex is not found", async () => {
    // First call: npx @openai/codex --version throws ENOENT
    vi.mocked(execa).mockImplementationOnce(
      () => Promise.reject(new Error("spawn npx ENOENT")) as unknown as ReturnType<typeof execa>,
    );
    // Second call: which npx also fails
    vi.mocked(execa).mockImplementationOnce(
      () =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "",
        }) as unknown as ReturnType<typeof execa>,
    );

    const adapter = new CodexAdapter();
    const availability = await adapter.checkAvailability();

    expect(availability.available).toBe(false);
    expect(availability.error).toBe(
      "Codex CLI is not available. Install via: npm install -g @openai/codex",
    );
  });

  it("execute spawns codex process with correct args", async () => {
    vi.mocked(execa).mockReturnValueOnce(createMockSubprocess());

    const adapter = new CodexAdapter();
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

    expect(execution.providerId).toBe("codex");
    expect(execa).toHaveBeenCalledWith(
      "npx",
      [
        "--yes",
        "@openai/codex",
        "exec",
        "--full-auto",
        "--json",
        "--ephemeral",
        "-C",
        "/tmp/project",
        "Fix all issues",
      ],
      expect.objectContaining({
        cwd: "/tmp/project",
        reject: false,
        timeout: 10_000,
        env: expect.objectContaining({
          CUSTOM_ENV: "abc",
          OAC_TOKEN_BUDGET: "7777",
          OAC_ALLOW_COMMITS: "true",
          CODEX_MANAGED_BY_NPM: "1",
        }),
      }),
    );
  });

  it("execute streams stdout events", async () => {
    vi.mocked(execa).mockReturnValueOnce(
      createMockSubprocess({
        stdoutLines: ["first line", "second line"],
      }),
    );

    const adapter = new CodexAdapter();
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
    vi.mocked(execa).mockReturnValueOnce(
      createMockSubprocess({
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
      }),
    );

    const adapter = new CodexAdapter();
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

  it("execute parses Codex JSONL envelope events", async () => {
    vi.mocked(execa).mockReturnValueOnce(
      createMockSubprocess({
        stdoutLines: [
          // Codex thread lifecycle
          JSON.stringify({ type: "thread.started", thread_id: "t-123" }),
          JSON.stringify({ type: "turn.started" }),
          // Codex command execution → tool_use
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_0",
              type: "command_execution",
              command: "/bin/zsh -lc 'npm test'",
              aggregated_output: "ok\n",
              exit_code: 0,
              status: "completed",
            },
          }),
          // Codex file change → file_edit
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_1",
              type: "file_change",
              path: "src/index.ts",
              action: "modify",
            },
          }),
          // Codex turn.completed → tokens
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 15328, cached_input_tokens: 13184, output_tokens: 283 },
          }),
        ],
      }),
    );

    const adapter = new CodexAdapter();
    const execution = adapter.execute(makeParams());
    const eventsPromise = collectEvents(execution.events);
    const result = await execution.result;
    const events = await eventsPromise;

    const tokenEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "tokens" }> => event.type === "tokens",
    );
    expect(tokenEvent).toEqual({
      type: "tokens",
      inputTokens: 15328,
      outputTokens: 283,
      cumulativeTokens: 15328 + 283,
    });

    const fileEditEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "file_edit" }> => event.type === "file_edit",
    );
    expect(fileEditEvent).toEqual({
      type: "file_edit",
      path: "src/index.ts",
      action: "modify",
    });

    const toolUseEvent = events.find(
      (event): event is Extract<AgentEvent, { type: "tool_use" }> => event.type === "tool_use",
    );
    expect(toolUseEvent).toEqual({
      type: "tool_use",
      tool: "shell",
      input: { command: "/bin/zsh -lc 'npm test'" },
    });

    expect(result.filesChanged).toEqual(["src/index.ts"]);
    expect(result.totalTokensUsed).toBe(15328 + 283);
  });

  it("execute handles process exit", async () => {
    vi.mocked(execa).mockReturnValueOnce(
      createMockSubprocess({
        settled: {
          exitCode: 7,
          stdout: "stdout failure",
          stderr: "stderr failure",
        },
      }),
    );

    const adapter = new CodexAdapter();
    const execution = adapter.execute(makeParams());
    const result = await execution.result;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.error).toBe("stderr failure");
  });

  it("execute handles timeout", async () => {
    vi.mocked(execa).mockReturnValueOnce(
      createMockSubprocess({
        settled: {
          exitCode: 124,
          stdout: "",
          stderr: "",
          timedOut: true,
        },
      }),
    );

    const adapter = new CodexAdapter();
    const execution = adapter.execute(makeParams({ executionId: "execution-timeout" }));
    const eventsPromise = collectEventsSafe(execution.events);

    await expect(execution.result).rejects.toMatchObject({
      code: "AGENT_TIMEOUT",
    });

    const events = await eventsPromise;
    const hasErrorEvent = events.some((event) => event.type === "error");
    expect(hasErrorEvent).toBe(true);
  });

  it("abort kills running process", async () => {
    const pending = createPendingSubprocess();
    vi.mocked(execa).mockReturnValueOnce(pending.subprocess);

    const adapter = new CodexAdapter();
    const execution = adapter.execute(makeParams({ executionId: "execution-abort" }));
    const resultPromise = execution.result.catch((error) => error);

    await adapter.abort("execution-abort");
    const failure = await resultPromise;

    expect(pending.kill).toHaveBeenCalledWith("SIGTERM");
    expect(failure).toBeInstanceOf(OacError);
  });

  it("abort ignores unknown execution ids", async () => {
    const adapter = new CodexAdapter();

    await expect(adapter.abort("missing")).resolves.toBeUndefined();
  });

  it("estimateTokens returns feasible for small tasks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oac-codex-small-"));
    const filePath = join(directory, "small.ts");
    await writeFile(filePath, "const ok = true;\n");

    const adapter = new CodexAdapter();
    const estimate = await adapter.estimateTokens({
      taskId: "task-small",
      prompt: "Fix lint warning",
      targetFiles: [filePath],
    });

    expect(estimate.providerId).toBe("codex");
    expect(estimate.feasible).toBe(true);
    expect(estimate.totalEstimatedTokens).toBeLessThan(200_000);
  });

  it("estimateTokens returns infeasible for huge tasks", async () => {
    const adapter = new CodexAdapter();
    const targetFiles = Array.from({ length: 120 }, (_, index) => `/tmp/huge-${index}.ts`);

    const estimate = await adapter.estimateTokens({
      taskId: "task-huge",
      prompt: "x",
      targetFiles,
    });

    expect(estimate.feasible).toBe(false);
    expect(estimate.totalEstimatedTokens).toBeGreaterThan(200_000);
  });
});
