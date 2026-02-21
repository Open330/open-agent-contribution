import { resolve } from "node:path";

import { Command } from "commander";

import { loadBacklog, loadContext } from "../../discovery/index.js";
import { createUi, getGlobalOptions, loadOptionalConfig } from "../helpers.js";

export function createExplainCommand(): Command {
  const command = new Command("explain");

  command
    .description("Explain why a task or epic was selected and what the agent would do")
    .argument("<id>", "Task or epic ID (from scan / analyze / run --dry-run output)")
    .action(async (id: string, _options, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
      const contextDir = config?.analyze?.contextDir;

      const repoPath = resolve(process.cwd());

      // Load persisted analysis results
      const [context, backlog] = await Promise.all([
        loadContext(repoPath, contextDir),
        loadBacklog(repoPath, contextDir),
      ]);

      if (!context && !backlog) {
        const message = "No analysis context found. Run `oac analyze` first.";
        if (globalOptions.json) {
          console.log(JSON.stringify({ error: message }, null, 2));
        } else {
          console.error(ui.red(message));
        }
        process.exitCode = 1;
        return;
      }

      // Search findings
      const finding = context?.qualityReport.findings.find(
        (f) => f.title === id || f.filePath === id,
      );

      // Search epics
      const epic = backlog?.epics.find(
        (e) => e.id === id || e.title.toLowerCase().includes(id.toLowerCase()),
      );

      if (!finding && !epic) {
        const message = `No task or epic matching "${id}" found in the analysis context.`;
        if (globalOptions.json) {
          console.log(JSON.stringify({ error: message, id }, null, 2));
        } else {
          console.error(ui.red(message));
          console.log("");
          printAvailableIds(ui, context, backlog);
        }
        process.exitCode = 1;
        return;
      }

      if (globalOptions.json) {
        console.log(JSON.stringify({ finding: finding ?? null, epic: epic ?? null }, null, 2));
        return;
      }

      if (epic) {
        console.log(ui.bold("Epic"));
        console.log(`  ${ui.blue("ID:")}        ${epic.id}`);
        console.log(`  ${ui.blue("Title:")}     ${epic.title}`);
        console.log(`  ${ui.blue("Scope:")}     ${epic.scope}`);
        console.log(`  ${ui.blue("Priority:")}  ${epic.priority}`);
        console.log(`  ${ui.blue("Status:")}    ${epic.status}`);
        console.log(`  ${ui.blue("Tasks:")}     ${epic.subtasks.length}`);
        console.log("");
        console.log(ui.dim("Description:"));
        console.log(`  ${epic.description}`);
        if (epic.subtasks.length > 0) {
          console.log("");
          console.log(ui.dim("Task IDs:"));
          for (const subtask of epic.subtasks) {
            console.log(`  - ${subtask.id}`);
          }
        }
      }

      if (finding) {
        if (epic) console.log("");
        console.log(ui.bold("Finding"));
        console.log(`  ${ui.blue("Title:")}      ${finding.title}`);
        console.log(`  ${ui.blue("Source:")}     ${finding.source.replace(/-/g, " ")}`);
        console.log(`  ${ui.blue("Scanner:")}   ${finding.scannerId}`);
        console.log(`  ${ui.blue("Severity:")}  ${colorSeverity(ui, finding.severity)}`);
        console.log(`  ${ui.blue("Complexity:")} ${finding.complexity}`);
        console.log(`  ${ui.blue("File:")}      ${finding.filePath}`);
        if (finding.module) {
          console.log(`  ${ui.blue("Module:")}    ${finding.module}`);
        }
        if (finding.line) {
          console.log(`  ${ui.blue("Line:")}      ${finding.line}`);
        }
        console.log("");
        console.log(ui.dim("Description:"));
        console.log(`  ${finding.description}`);
        console.log("");
        console.log(ui.dim("What the agent would do:"));
        console.log("  1. Check out a clean branch for this task");
        console.log(
          `  2. Open ${finding.filePath}${finding.line ? ` at line ${finding.line}` : ""}`,
        );
        console.log("  3. Apply the fix described above");
        console.log("  4. Run tests and linters to verify");
        console.log("  5. Create a PR with the changes");
      }
    });

  command.addHelpText(
    "after",
    `\nExamples:
  $ oac explain "Add tests for client.ts"
  $ oac explain src/lib/client.ts`,
  );

  return command;
}

function colorSeverity(
  ui: import("chalk").ChalkInstance,
  severity: "info" | "warning" | "error",
): string {
  if (severity === "error") return ui.red(severity);
  if (severity === "warning") return ui.yellow(severity);
  return ui.green(severity);
}

function printAvailableIds(
  ui: import("chalk").ChalkInstance,
  context: Awaited<ReturnType<typeof loadContext>>,
  backlog: Awaited<ReturnType<typeof loadBacklog>>,
): void {
  const findings = context?.qualityReport.findings ?? [];
  const epics = backlog?.epics ?? [];

  if (findings.length > 0) {
    console.log(ui.dim(`Available findings (${findings.length}):`));
    for (const f of findings.slice(0, 8)) {
      console.log(`  - ${f.title}`);
    }
    if (findings.length > 8) console.log(ui.dim(`  ... and ${findings.length - 8} more`));
  }

  if (epics.length > 0) {
    console.log(ui.dim(`Available epics (${epics.length}):`));
    for (const e of epics.slice(0, 8)) {
      console.log(`  - ${e.id}: ${e.title}`);
    }
    if (epics.length > 8) console.log(ui.dim(`  ... and ${epics.length - 8} more`));
  }
}
