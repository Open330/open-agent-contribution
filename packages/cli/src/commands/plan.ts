import { buildExecutionPlan, estimateTokens } from "@open330/oac-budget";
import type { OacConfig, Task } from "@open330/oac-core";
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

interface PlanCommandOptions {
  repo?: string;
  tokens?: number;
  provider?: string;
}

type SupportedScanner = "lint" | "todo";

export function createPlanCommand(): Command {
  const command = new Command("plan");

  command
    .description("Build an execution plan from discovered tasks")
    .option("--repo <owner/repo>", "Target repository (owner/repo or GitHub URL)")
    .option("--tokens <number>", "Token budget for planning", parseInteger)
    .option("--provider <id>", "Agent provider id")
    .action(async (options: PlanCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      const outputJson = globalOptions.json;

      const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
      const repoInput = resolveRepoInput(options.repo, config);
      const providerId = resolveProviderId(options.provider, config);
      const totalBudget = resolveBudget(options.tokens, config);
      const minPriority = config?.discovery.minPriority ?? 20;

      const scannerSelection = selectScannersFromConfig(config);

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
      scanSpinner?.succeed(`Discovered ${scannedTasks.length} raw task(s)`);

      const rankedTasks = rankTasks(scannedTasks).filter((task) => task.priority >= minPriority);

      const estimateSpinner = createSpinner(
        outputJson,
        `Estimating tokens for ${rankedTasks.length} task(s)...`,
      );
      const estimates = await estimateTaskMap(rankedTasks, providerId);
      estimateSpinner?.succeed("Token estimation completed");

      const plan = buildExecutionPlan(rankedTasks, estimates, totalBudget);

      if (outputJson) {
        console.log(
          JSON.stringify(
            {
              repo: resolvedRepo.fullName,
              provider: providerId,
              budget: totalBudget,
              tasksDiscovered: rankedTasks.length,
              plan,
            },
            null,
            2,
          ),
        );
        return;
      }

      renderPlan(ui, {
        repo: resolvedRepo.fullName,
        provider: providerId,
        budget: totalBudget,
        plan,
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

function resolveProviderId(providerOption: string | undefined, config: OacConfig | null): string {
  const fromFlag = providerOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  return config?.provider.id ?? "claude-code";
}

function resolveBudget(tokensOption: number | undefined, config: OacConfig | null): number {
  const budget = tokensOption ?? config?.budget.totalTokens ?? 100_000;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("Token budget must be a positive number.");
  }

  return Math.floor(budget);
}

function selectScannersFromConfig(config: OacConfig | null): {
  enabled: SupportedScanner[];
  scanner: CompositeScanner;
} {
  const enabled: SupportedScanner[] = [];

  if (config?.discovery.scanners.lint !== false) {
    enabled.push("lint");
  }

  if (config?.discovery.scanners.todo !== false) {
    enabled.push("todo");
  }

  if (enabled.length === 0) {
    enabled.push("lint", "todo");
  }

  const uniqueEnabled = [...new Set(enabled)];
  const scannerInstances: Scanner[] = uniqueEnabled.map((scannerName) =>
    scannerName === "lint" ? new LintScanner() : new TodoScanner(),
  );

  return {
    enabled: uniqueEnabled,
    scanner: new CompositeScanner(scannerInstances),
  };
}

async function estimateTaskMap(
  tasks: Task[],
  providerId: string,
): Promise<Map<string, Awaited<ReturnType<typeof estimateTokens>>>> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const estimate = await estimateTokens(task, providerId);
      return [task.id, estimate] as const;
    }),
  );

  return new Map(entries);
}

function renderPlan(
  ui: ChalkInstance,
  data: {
    repo: string;
    provider: string;
    budget: number;
    plan: ReturnType<typeof buildExecutionPlan>;
  },
): void {
  const table = new Table({
    head: ["#", "Task", "Est. Tokens", "Cumulative", "Confidence"],
  });

  for (let index = 0; index < data.plan.selectedTasks.length; index += 1) {
    const entry = data.plan.selectedTasks[index];
    table.push([
      String(index + 1),
      truncate(entry.task.title, 56),
      formatInteger(entry.estimate.totalEstimatedTokens),
      formatInteger(entry.cumulativeBudgetUsed),
      entry.estimate.confidence.toFixed(2),
    ]);
  }

  console.log(ui.bold(`Execution Plan for ${data.repo}`));
  console.log(`Provider: ${data.provider}`);
  console.log("");

  if (data.plan.selectedTasks.length > 0) {
    console.log(table.toString());
    console.log("");
  } else {
    console.log(ui.yellow("No tasks selected for execution."));
    console.log("");
  }

  const effectiveBudget = data.plan.totalBudget - data.plan.reserveTokens;
  const budgetUsed =
    data.plan.selectedTasks[data.plan.selectedTasks.length - 1]?.cumulativeBudgetUsed ?? 0;

  console.log(
    `Budget used: ${formatInteger(budgetUsed)} / ${formatInteger(effectiveBudget)} (effective)`,
  );
  console.log(`Reserve:     ${formatInteger(data.plan.reserveTokens)} (10%)`);
  console.log(`Remaining:   ${formatInteger(data.plan.remainingTokens)}`);

  if (data.plan.deferredTasks.length > 0) {
    console.log("");
    console.log(ui.yellow(`Deferred (${data.plan.deferredTasks.length}):`));
    for (const deferred of data.plan.deferredTasks) {
      const reason = deferred.reason.replaceAll("_", " ");
      console.log(
        `  - ${truncate(deferred.task.title, 72)} (${formatInteger(
          deferred.estimate.totalEstimatedTokens,
        )} tokens, ${reason})`,
      );
    }
  }
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
