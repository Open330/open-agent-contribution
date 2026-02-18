import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Command } from "commander";

import type { GlobalCliOptions } from "../cli.js";

interface StatusCommandOptions {
  watch?: boolean;
}

interface RunStatus {
  runId: string;
  startedAt: string;
  agent: string;
  tasks: RunStatusTask[];
}

interface RunStatusTask {
  taskId: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

const WATCH_INTERVAL_MS = 2_000;

export function createStatusCommand(): Command {
  const command = new Command("status");

  command
    .description("Show current job status")
    .option("--watch", "Poll every 2 seconds", false)
    .action(async (options: StatusCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);

      const render = async (): Promise<void> => {
        const status = await readRunStatus(process.cwd());
        renderStatusOutput(status, globalOptions.json);
      };

      await render();

      if (!options.watch) {
        return;
      }

      const intervalId = setInterval(() => {
        console.clear();
        void render().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(message);
          process.exitCode = 1;
        });
      }, WATCH_INTERVAL_MS);

      process.on("SIGINT", () => {
        clearInterval(intervalId);
        console.log("\nWatch mode stopped.");
        process.exit(0);
      });
    });

  return command;
}

function getGlobalOptions(command: Command): Required<GlobalCliOptions> {
  const options = command.optsWithGlobals<GlobalCliOptions>();

  return {
    config: options.config ?? "oac.config.ts",
    verbose: options.verbose === true,
    json: options.json === true,
    color: options.color !== false,
  };
}

async function readRunStatus(repoPath: string): Promise<RunStatus | null> {
  const statusPath = resolve(repoPath, ".oac", "status.json");

  try {
    const raw = await readFile(statusPath, "utf8");
    const payload = JSON.parse(raw) as unknown;
    return parseRunStatus(payload);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

function parseRunStatus(payload: unknown): RunStatus {
  if (!isRecord(payload)) {
    throw new Error("Invalid .oac/status.json format.");
  }

  const runId = payload.runId;
  const startedAt = payload.startedAt;
  const agent = payload.agent;
  const tasks = payload.tasks;

  if (
    typeof runId !== "string" ||
    typeof startedAt !== "string" ||
    typeof agent !== "string" ||
    !Array.isArray(tasks)
  ) {
    throw new Error("Invalid .oac/status.json format.");
  }

  return {
    runId,
    startedAt,
    agent,
    tasks: tasks.map((task, index) => parseRunStatusTask(task, index)),
  };
}

function parseRunStatusTask(task: unknown, index: number): RunStatusTask {
  if (!isRecord(task)) {
    throw new Error(`Invalid task at index ${String(index)} in .oac/status.json.`);
  }

  const taskId = task.taskId;
  const title = task.title;
  const status = task.status;
  const startedAt = task.startedAt;
  const completedAt = task.completedAt;
  const error = task.error;

  if (
    typeof taskId !== "string" ||
    typeof title !== "string" ||
    (status !== "pending" && status !== "running" && status !== "completed" && status !== "failed")
  ) {
    throw new Error(`Invalid task at index ${String(index)} in .oac/status.json.`);
  }

  if (startedAt !== undefined && typeof startedAt !== "string") {
    throw new Error(`Invalid task at index ${String(index)} in .oac/status.json.`);
  }

  if (completedAt !== undefined && typeof completedAt !== "string") {
    throw new Error(`Invalid task at index ${String(index)} in .oac/status.json.`);
  }

  if (error !== undefined && typeof error !== "string") {
    throw new Error(`Invalid task at index ${String(index)} in .oac/status.json.`);
  }

  return {
    taskId,
    title,
    status,
    startedAt,
    completedAt,
    error,
  };
}

function renderStatusOutput(status: RunStatus | null, outputJson: boolean): void {
  if (outputJson) {
    if (!status) {
      console.log(
        JSON.stringify(
          {
            active: false,
            message: "No active runs",
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      JSON.stringify(
        {
          active: true,
          status,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!status) {
    console.log("No active runs");
    return;
  }

  const runningTasks = status.tasks.filter((task) => task.status === "running");
  const completedTasks = status.tasks.filter((task) => task.status === "completed");
  const failedTasks = status.tasks.filter((task) => task.status === "failed");

  console.log(`Run ID: ${status.runId}`);
  console.log(`Start Time: ${status.startedAt}`);
  console.log(`Agent: ${status.agent}`);
  console.log(
    `Tasks In Progress (${String(runningTasks.length)}): ${formatTaskList(runningTasks)}`,
  );
  console.log(
    `Completed Tasks (${String(completedTasks.length)}): ${formatTaskList(completedTasks)}`,
  );

  if (failedTasks.length === 0) {
    console.log("Errors: none");
    return;
  }

  console.log(`Errors (${String(failedTasks.length)}):`);
  for (const task of failedTasks) {
    console.log(`- ${task.taskId}: ${task.error ?? "Unknown error"}`);
  }
}

function formatTaskList(tasks: RunStatusTask[]): string {
  if (tasks.length === 0) {
    return "-";
  }

  return tasks.map((task) => `${task.taskId} (${task.title})`).join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === "ENOENT";
}
