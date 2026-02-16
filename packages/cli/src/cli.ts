import { readFile } from "node:fs/promises";
import { Command } from "commander";

import { createDoctorCommand } from "./commands/doctor.js";
import { createInitCommand } from "./commands/init.js";
import { createLeaderboardCommand } from "./commands/leaderboard.js";
import { createLogCommand } from "./commands/log.js";
import { createPlanCommand } from "./commands/plan.js";
import { createRunCommand } from "./commands/run.js";
import { createScanCommand } from "./commands/scan.js";
import { createStatusCommand } from "./commands/status.js";

export interface GlobalCliOptions {
  config?: string;
  verbose?: boolean;
  json?: boolean;
  color?: boolean;
}

async function readCliVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const packageJsonRaw = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown };

    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Fall back to a safe default when package metadata is unavailable.
  }

  return "0.0.0";
}

function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createScanCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createLogCommand());
  program.addCommand(createLeaderboardCommand());
  program.addCommand(createStatusCommand());
}

export async function createCliProgram(): Promise<Command> {
  const version = await readCliVersion();

  const program = new Command();
  program
    .name("oac")
    .description("Open Agent Contribution CLI")
    .version(version)
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  registerCommands(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = await createCliProgram();
  await program.parseAsync([...argv]);
}
