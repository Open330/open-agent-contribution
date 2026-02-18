import type { ChalkInstance } from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { buildExecutionPlan } from "../../budget/index.js";
import type { OacConfig } from "../../core/index.js";
import {
  CompositeScanner,
  LintScanner,
  type Scanner,
  TodoScanner,
  rankTasks,
} from "../../discovery/index.js";
import { cloneRepo, resolveRepo } from "../../repo/index.js";
import { ensureGitHubAuth } from "../github-auth.js";

import {
  createSpinner,
  createUi,
  estimateTaskMap,
  formatInteger,
  getGlobalOptions,
  loadOptionalConfig,
  parseInteger,
  resolveBudget,
  resolveProviderId,
  resolveRepoInput,
  truncate,
} from "../helpers.js";

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

      ensureGitHubAuth();

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

  command.addHelpText(
    "after",
    `\nExamples:
  $ oac plan --repo owner/repo --tokens 100000
  $ oac plan --repo owner/repo --provider codex`,
  );

  return command;
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


