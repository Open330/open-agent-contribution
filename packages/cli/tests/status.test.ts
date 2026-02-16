import { readFile } from "node:fs/promises";

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStatusCommand } from "../src/commands/status.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);

interface RunStatus {
  runId: string;
  startedAt: string;
  agent: string;
  tasks: Array<{
    taskId: string;
    title: string;
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
}

interface StatusJsonPayload {
  active: boolean;
  message?: string;
  status?: RunStatus;
}

function createRootProgram(): Command {
  const root = new Command()
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  root.addCommand(createStatusCommand());
  return root;
}

function createErrno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function makeRunStatus(): RunStatus {
  return {
    runId: "run-123",
    startedAt: "2026-02-16T12:00:00+00:00",
    agent: "claude-code",
    tasks: [
      {
        taskId: "task-running",
        title: "Implement command",
        status: "running",
        startedAt: "2026-02-16T12:01:00+00:00",
      },
      {
        taskId: "task-completed",
        title: "Write tests",
        status: "completed",
        startedAt: "2026-02-16T12:02:00+00:00",
        completedAt: "2026-02-16T12:04:00+00:00",
      },
      {
        taskId: "task-failed",
        title: "Fix flaky test",
        status: "failed",
        error: "timeout",
      },
    ],
  };
}

async function runStatusJson(args: string[] = []): Promise<StatusJsonPayload> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "--json", "status", ...args]);

  const output = logSpy.mock.calls.at(-1)?.[0];
  if (typeof output !== "string") {
    throw new Error("Expected JSON output from status command.");
  }

  return JSON.parse(output) as StatusJsonPayload;
}

async function runStatusTable(args: string[] = []): Promise<string> {
  const root = createRootProgram();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await root.parseAsync(["node", "oac", "status", ...args]);

  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedReadFile.mockReset();
});

describe("createStatusCommand", () => {
  it("returns a Commander Command instance", () => {
    const command = createStatusCommand();
    expect(command.name()).toBe("status");
  });

  it("handles missing status file", async () => {
    mockedReadFile.mockRejectedValue(createErrno("ENOENT"));

    const output = await runStatusTable();

    expect(output).toContain("No active runs");
  });

  it("parses and displays status details", async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify(makeRunStatus()));

    const output = await runStatusTable();

    expect(output).toContain("Run ID: run-123");
    expect(output).toContain("Agent: claude-code");
    expect(output).toContain("Tasks In Progress (1)");
    expect(output).toContain("Completed Tasks (1)");
    expect(output).toContain("task-failed: timeout");
  });

  it("outputs JSON status payload when --json is set", async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify(makeRunStatus()));

    const payload = await runStatusJson();

    expect(payload.active).toBe(true);
    expect(payload.status?.runId).toBe("run-123");
    expect(payload.status?.tasks).toHaveLength(3);
  });

  it("enables polling when --watch is set", async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify(makeRunStatus()));

    let intervalCallback: (() => void) | null = null;
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((handler: TimerHandler, _timeout?: number) => {
        if (typeof handler === "function") {
          intervalCallback = handler;
        }
        return 1 as unknown as NodeJS.Timeout;
      });
    const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const root = createRootProgram();
    await root.parseAsync(["node", "oac", "status", "--watch"]);

    expect(intervalSpy).toHaveBeenCalledOnce();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);

    intervalCallback?.();
    await Promise.resolve();

    expect(clearSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
