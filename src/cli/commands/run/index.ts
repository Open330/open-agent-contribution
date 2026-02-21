import { Command } from "commander";
import { UNLIMITED_BUDGET } from "../../../core/index.js";
import { createUi, getGlobalOptions, parseInteger } from "../../helpers.js";
import { runPipeline, validateRunOptions } from "./pipeline.js";
import type { RunCommandOptions } from "./types.js";

function parseTokens(value: string): number {
  if (value.toLowerCase() === "unlimited") {
    return UNLIMITED_BUDGET;
  }
  return parseInteger(value);
}

export function createRunCommand(): Command {
  const command = new Command("run");

  command
    .alias("r")
    .description("Run the full OAC pipeline — analyze, plan, and execute in one command")
    .option("--repo <owner/repo>", "Target repository (owner/repo or GitHub URL)")
    .option("--tokens <value>", 'Token budget (number or "unlimited")', parseTokens)
    .option("--provider <id>", "Agent provider id")
    .option("--concurrency <number>", "Maximum parallel task executions", parseInteger)
    .option("--dry-run", "Show plan without executing tasks", false)
    .option("--mode <mode>", "Execution mode: new-pr|update-pr|direct-commit")
    .option("--max-tasks <number>", "Maximum number of discovered tasks to consider", parseInteger)
    .option("--timeout <seconds>", "Per-task timeout in seconds", parseInteger)
    .option("--source <source>", "Filter tasks by source: lint, todo, github-issue, test-gap")
    .option("--retry-failed", "Re-run only failed tasks from the most recent run", false)
    .action(async (options: RunCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      validateRunOptions(options);
      await runPipeline(options, globalOptions, ui);
    });

  command.addHelpText(
    "after",
    `\nThis is the primary command. It auto-analyzes the codebase, groups findings
into epics, and executes them — no separate scan/analyze step required.

If no oac.config.ts exists, pass --repo to get started immediately:
  $ oac run --repo owner/repo

Examples:
  $ oac run --repo owner/repo --tokens 50000
  $ oac run --repo owner/repo --provider codex --concurrency 4
  $ oac run --repo owner/repo --dry-run
  $ oac run --repo owner/repo --source lint --max-tasks 10
  $ oac run --repo owner/repo --retry-failed

Exit Codes:
  0   All tasks/epics completed successfully (or dry-run)
  1   Unexpected / unhandled error
  2   Configuration or validation error (bad flags, missing repo)
  3   All selected tasks/epics failed
  4   Partial success — some tasks succeeded, others failed`,
  );

  return command;
}
