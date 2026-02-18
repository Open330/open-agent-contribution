import type { ChalkInstance } from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import type { OacConfig } from "../../core/index.js";
import {
  CompositeScanner,
  GitHubIssuesScanner,
  LintScanner,
  type Scanner,
  TestGapScanner,
  TodoScanner,
  rankTasks,
} from "../../discovery/index.js";
import { cloneRepo, resolveRepo } from "../../repo/index.js";
import { ensureGitHubAuth } from "../github-auth.js";

import {
  createSpinner,
  createUi,
  getGlobalOptions,
  loadOptionalConfig,
  parseInteger,
  resolveRepoInput,
  truncate,
} from "../helpers.js";

interface ScanCommandOptions {
  repo?: string;
  scanners?: string;
  minPriority: number;
  format: string;
}

type OutputFormat = "table" | "json";
type SupportedScanner = "lint" | "todo" | "github-issues" | "test-gap";

const SUPPORTED_SCANNERS: SupportedScanner[] = ["lint", "todo", "github-issues", "test-gap"];

export function createScanCommand(): Command {
  const command = new Command("scan");

  command
    .description("Quick task discovery — list individual issues ranked by priority")
    .option("--repo <owner/repo>", "Target repository (owner/repo or GitHub URL)")
    .option("--scanners <names>", "Comma-separated scanner filter (lint,todo)")
    .option("--min-priority <number>", "Minimum priority threshold (0-100)", parseInteger, 20)
    .option("--format <format>", "Output format: table|json", "table")
    .action(async (options: ScanCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);

      const outputFormat = normalizeOutputFormat(options.format);
      const outputJson = globalOptions.json || outputFormat === "json";

      if (options.minPriority < 0 || options.minPriority > 100) {
        throw new Error("--min-priority must be between 0 and 100.");
      }

      const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
      const repoInput = resolveRepoInput(options.repo, config);
      const ghToken = ensureGitHubAuth();
      const scannerSelection = selectScanners(options.scanners, config, Boolean(ghToken));

      if (!outputJson && scannerSelection.unknown.length > 0) {
        console.log(
          ui.yellow(
            `Ignoring unsupported scanner(s): ${scannerSelection.unknown.join(", ")}. Supported scanners: ${SUPPORTED_SCANNERS.join(", ")}.`,
          ),
        );
      }

      const resolveSpinner = createSpinner(outputJson, "Resolving repository...");
      const resolvedRepo = await resolveRepo(repoInput);
      resolveSpinner?.succeed(`Resolved ${resolvedRepo.fullName}`);

      const cloneSpinner = createSpinner(outputJson, "Preparing local clone...");
      await cloneRepo(resolvedRepo);
      cloneSpinner?.succeed(`Repository ready at ${resolvedRepo.localPath}`);

      const scanSpinner = createSpinner(
        outputJson,
        `Running scanners: ${scannerSelection.enabled.join(", ")}`,
      );

      const scannedTasks = await scannerSelection.scanner.scan(resolvedRepo.localPath, {
        exclude: config?.discovery.exclude,
        maxTasks: config?.discovery.maxTasks,
        repo: resolvedRepo,
      });

      scanSpinner?.succeed(`Scanned ${resolvedRepo.fullName}`);

      const rankedTasks = rankTasks(scannedTasks).filter(
        (task) => task.priority >= options.minPriority,
      );

      if (outputJson) {
        console.log(
          JSON.stringify(
            {
              repo: resolvedRepo.fullName,
              scanners: scannerSelection.enabled,
              minPriority: options.minPriority,
              totalTasks: rankedTasks.length,
              tasks: rankedTasks,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (rankedTasks.length === 0) {
        console.log(ui.yellow("No tasks discovered for the selected criteria."));
        return;
      }

      const table = new Table({
        head: ["ID", "Title", "Source", "Priority", "Complexity"],
      });

      for (const task of rankedTasks) {
        table.push([
          task.id,
          truncate(task.title, 60),
          task.source,
          String(task.priority),
          task.complexity,
        ]);
      }

      console.log(table.toString());
      console.log("");
      console.log(
        ui.blue(
          `Found ${rankedTasks.length} task(s). Use \`oac plan --repo ${resolvedRepo.fullName} --tokens <n>\` to build an execution plan.`,
        ),
      );
    });

  command.addHelpText(
    "after",
    `\nScan runs lightweight scanners and outputs a flat list of ranked tasks.
For deeper analysis that groups findings into epics, use \`oac analyze\`.
To run the full pipeline (analyze + execute), use \`oac run\`.

Examples:
  $ oac scan --repo owner/repo
  $ oac scan --repo owner/repo --scanners lint,todo
  $ oac scan --repo owner/repo --min-priority 50 --format json`,
  );

  return command;
}

function normalizeOutputFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "table" || normalized === "json") {
    return normalized;
  }

  throw new Error(`Unsupported --format value "${value}". Use "table" or "json".`);
}

function selectScanners(
  scannerOption: string | undefined,
  config: OacConfig | null,
  hasGitHubAuth = false,
): {
  enabled: SupportedScanner[];
  unknown: string[];
  scanner: CompositeScanner;
} {
  const defaultScanners: SupportedScanner[] = ["lint", "todo", "test-gap"];
  if (hasGitHubAuth) {
    defaultScanners.push("github-issues");
  }
  const requested = scannerOption
    ? parseCsv(scannerOption)
    : (scannersFromConfig(config, hasGitHubAuth) ?? defaultScanners);

  const enabled: SupportedScanner[] = [];
  const unknown: string[] = [];

  for (const scannerName of requested) {
    const normalized = scannerName.toLowerCase();
    if (
      normalized === "lint" ||
      normalized === "todo" ||
      normalized === "github-issues" ||
      normalized === "test-gap"
    ) {
      enabled.push(normalized as SupportedScanner);
    } else {
      unknown.push(scannerName);
    }
  }

  const uniqueEnabled = [...new Set(enabled)];
  if (uniqueEnabled.length === 0) {
    throw new Error(
      `No supported scanners selected. Supported scanners: ${SUPPORTED_SCANNERS.join(", ")}.`,
    );
  }

  const scannerInstances: Scanner[] = uniqueEnabled.map((name) => {
    if (name === "lint") return new LintScanner();
    if (name === "github-issues") return new GitHubIssuesScanner();
    if (name === "test-gap") return new TestGapScanner();
    return new TodoScanner();
  });

  return {
    enabled: uniqueEnabled,
    unknown,
    scanner: new CompositeScanner(scannerInstances),
  };
}

function scannersFromConfig(
  config: OacConfig | null,
  hasGitHubAuth = false,
): SupportedScanner[] | null {
  if (!config) {
    return null;
  }

  const configured: SupportedScanner[] = [];
  if (config.discovery.scanners.lint) {
    configured.push("lint");
  }
  if (config.discovery.scanners.todo) {
    configured.push("todo");
  }
  if (config.discovery.scanners.testGap) {
    configured.push("test-gap");
  }
  if (hasGitHubAuth) {
    configured.push("github-issues");
  }

  if (configured.length === 0) {
    return null;
  }

  return configured;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}


