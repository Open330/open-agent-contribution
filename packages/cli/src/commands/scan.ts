import type { OacConfig } from "@open330/oac-core";
import {
  CompositeScanner,
  LintScanner,
  type Scanner,
  TodoScanner,
  rankTasks,
} from "@open330/oac-discovery";
import { cloneRepo, resolveRepo } from "@open330/oac-repo";
import chalk, { Chalk, type ChalkInstance } from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import ora, { type Ora } from "ora";

import type { GlobalCliOptions } from "../cli.js";
import { loadOptionalConfigFile } from "../config-loader.js";

interface ScanCommandOptions {
  repo?: string;
  scanners?: string;
  minPriority: number;
  format: string;
}

type OutputFormat = "table" | "json";
type SupportedScanner = "lint" | "todo";

const SUPPORTED_SCANNERS: SupportedScanner[] = ["lint", "todo"];

export function createScanCommand(): Command {
  const command = new Command("scan");

  command
    .description("Discover tasks in a repository")
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
      const scannerSelection = selectScanners(options.scanners, config);

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

function createUi(options: Required<GlobalCliOptions>): ChalkInstance {
  const noColorEnv = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  const colorEnabled = options.color && !noColorEnv;

  return new Chalk({ level: colorEnabled ? chalk.level : 0 });
}

function createSpinner(enabled: boolean, text: string): Ora | null {
  if (enabled) {
    return null;
  }

  return ora({ text, color: "blue" }).start();
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer but received "${value}".`);
  }

  return parsed;
}

function normalizeOutputFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "table" || normalized === "json") {
    return normalized;
  }

  throw new Error(`Unsupported --format value "${value}". Use "table" or "json".`);
}

async function loadOptionalConfig(
  configPath: string,
  verbose: boolean,
  ui: ChalkInstance,
): Promise<OacConfig | null> {
  return loadOptionalConfigFile(configPath, {
    onWarning: verbose
      ? (message) => {
          console.warn(ui.yellow(`[oac] ${message}`));
        }
      : undefined,
  });
}

function resolveRepoInput(repoOption: string | undefined, config: OacConfig | null): string {
  const fromFlag = repoOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  const firstConfiguredRepo = config?.repos[0];
  if (typeof firstConfiguredRepo === "string") {
    return firstConfiguredRepo;
  }

  if (
    firstConfiguredRepo &&
    typeof firstConfiguredRepo === "object" &&
    "name" in firstConfiguredRepo &&
    typeof firstConfiguredRepo.name === "string"
  ) {
    return firstConfiguredRepo.name;
  }

  throw new Error("No repository specified. Use --repo or configure repos in oac.config.ts.");
}

function selectScanners(
  scannerOption: string | undefined,
  config: OacConfig | null,
): {
  enabled: SupportedScanner[];
  unknown: string[];
  scanner: CompositeScanner;
} {
  const requested = scannerOption
    ? parseCsv(scannerOption)
    : (scannersFromConfig(config) ?? [...SUPPORTED_SCANNERS]);

  const enabled: SupportedScanner[] = [];
  const unknown: string[] = [];

  for (const scannerName of requested) {
    const normalized = scannerName.toLowerCase();
    if (normalized === "lint" || normalized === "todo") {
      enabled.push(normalized);
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

  const scannerInstances: Scanner[] = uniqueEnabled.map((name) =>
    name === "lint" ? new LintScanner() : new TodoScanner(),
  );

  return {
    enabled: uniqueEnabled,
    unknown,
    scanner: new CompositeScanner(scannerInstances),
  };
}

function scannersFromConfig(config: OacConfig | null): SupportedScanner[] | null {
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
