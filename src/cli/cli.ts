import { Command } from "commander";

import { createAnalyzeCommand } from "./commands/analyze.js";
import { createCompletionCommand } from "./commands/completion.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createInitCommand } from "./commands/init.js";
import { createLeaderboardCommand } from "./commands/leaderboard.js";
import { createLogCommand } from "./commands/log.js";
import { createPlanCommand } from "./commands/plan.js";
import { createRunCommand } from "./commands/run.js";
import { createScanCommand } from "./commands/scan.js";
import { createStatusCommand } from "./commands/status.js";

declare const __OAC_VERSION__: string;

export interface GlobalCliOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  color?: boolean;
}

function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createAnalyzeCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createScanCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createLogCommand());
  program.addCommand(createLeaderboardCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createCompletionCommand());
}

export async function createCliProgram(): Promise<Command> {
  const version = typeof __OAC_VERSION__ !== "undefined" ? __OAC_VERSION__ : "0.0.0";

  const program = new Command();
  program
    .name("oac")
    .description("Open Agent Contribution CLI")
    .version(version)
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--quiet", "Suppress non-error output", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  registerCommands(program);

  program.addHelpText(
    "after",
    `\nGetting Started:\n  $ oac init          Set up your project configuration\n  $ oac doctor        Verify your environment is ready\n  $ oac analyze       Analyze codebase for contribution opportunities\n  $ oac run           Run the full contribution pipeline\n\nDocumentation: https://github.com/Open330/open-agent-contribution\n`,
  );

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = await createCliProgram();
  await program.parseAsync([...argv]);
}
