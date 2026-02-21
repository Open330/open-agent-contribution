import { randomUUID } from "node:crypto";

import type { OacConfig } from "../../../core/index.js";
import { cloneRepo, resolveRepo } from "../../../repo/index.js";
import { checkGitHubScopes, ensureGitHubAuth } from "../../github-auth.js";
import {
  type GlobalCliOptions,
  createSpinner,
  loadOptionalConfig,
  resolveBudget,
  resolveProviderId,
  resolveRepoInput,
} from "../../helpers.js";
import { runEpicPipeline, tryLoadOrAnalyzeEpics } from "./epic.js";
import { runRetryPipeline } from "./retry.js";
import {
  discoverTasks,
  executePlan,
  printDryRunSummary,
  printEmptySummary,
  printFinalSummary,
} from "./task.js";
import { writeTracking } from "./tracking.js";
import type { PipelineContext, RunCommandOptions, RunMode } from "./types.js";
import {
  ConfigError,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_SECONDS,
  formatBudgetDisplay,
  resolveExitCode,
} from "./types.js";

export async function runPipeline(
  options: RunCommandOptions,
  globalOptions: Required<GlobalCliOptions>,
  ui: import("chalk").ChalkInstance,
): Promise<void> {
  const ctx: PipelineContext = {
    options,
    globalOptions,
    ui,
    outputJson: globalOptions.json,
    suppressOutput: globalOptions.json || globalOptions.quiet,
    runId: randomUUID(),
    runStartedAt: Date.now(),
  };

  const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
  const providerId = resolveProviderId(options.provider, config);
  const totalBudget = resolveBudget(options.tokens, config);
  const mode = resolveMode(options.mode, config);
  const concurrency = resolveConcurrency(options.concurrency, config);
  const timeoutSeconds = resolveTimeout(options.timeout, config);
  const ghToken = ensureGitHubAuth();

  printGitHubAuthWarnings(ctx, ghToken);
  printRunHeader(ctx, totalBudget, concurrency);

  const repoInput = resolveRepoInput(options.repo, config);

  const resolveSpinner = createSpinner(ctx.suppressOutput, "Resolving repository...");
  const resolvedRepo = await resolveRepo(repoInput);
  resolveSpinner?.succeed(`Resolved ${resolvedRepo.fullName}`);

  const cloneSpinner = createSpinner(ctx.suppressOutput, "Preparing local clone...");
  await cloneRepo(resolvedRepo);
  cloneSpinner?.succeed(`Repository ready at ${resolvedRepo.localPath}`);

  // ── Retry-failed shortcut ──────────────────────────────────
  if (options.retryFailed) {
    const retryResults = await runRetryPipeline(ctx, {
      resolvedRepo,
      providerId,
      totalBudget,
      concurrency,
      timeoutSeconds,
      mode,
      ghToken,
    });
    process.exitCode = resolveExitCode(retryResults);
    return;
  }

  // ── Try epic-based execution (auto-analyze if needed) ────
  const autoAnalyze = config?.analyze?.autoAnalyze ?? true;
  const contextDir = config?.analyze?.contextDir ?? ".oac/context";
  const staleAfterMs = config?.analyze?.staleAfterMs ?? 86_400_000;

  const epics = await tryLoadOrAnalyzeEpics(ctx, {
    resolvedRepo,
    config,
    ghToken,
    autoAnalyze,
    contextDir,
    staleAfterMs,
  });

  if (epics && epics.length > 0) {
    const epicResults = await runEpicPipeline(ctx, {
      epics,
      resolvedRepo,
      config,
      providerId,
      totalBudget,
      concurrency,
      timeoutSeconds,
      mode,
      ghToken,
      contextDir,
    });
    process.exitCode = resolveExitCode(epicResults);
    return;
  }

  // ── Fallback: task-based execution (existing behavior) ──
  const { candidateTasks, plan } = await discoverTasks(ctx, options, config, ghToken, resolvedRepo);

  if (candidateTasks.length === 0) {
    printEmptySummary(ctx, resolvedRepo.fullName, providerId, totalBudget);
    return;
  }

  if (options.dryRun) {
    printDryRunSummary(ctx, resolvedRepo.fullName, providerId, totalBudget, plan);
    return;
  }

  const completedTasks = await executePlan(ctx, {
    plan,
    providerId,
    resolvedRepo,
    concurrency,
    timeoutSeconds,
    mode,
    ghToken,
  });

  await writeTracking(ctx, {
    resolvedRepo,
    providerId,
    totalBudget,
    candidateTasks,
    completedTasks,
  });

  printFinalSummary(ctx, {
    plan,
    resolvedRepo,
    providerId,
    totalBudget,
    completedTasks,
  });

  process.exitCode = resolveExitCode(completedTasks);
}

function printGitHubAuthWarnings(ctx: PipelineContext, ghToken: string | undefined): void {
  if (ctx.suppressOutput) return;

  if (!ghToken) {
    console.log(
      ctx.ui.yellow("[oac] Warning: GitHub auth not detected. Run `gh auth login` first."),
    );
    console.log(
      ctx.ui.yellow("[oac] For private repos, ensure the 'repo' scope: gh auth refresh -s repo"),
    );
  } else {
    const missingScopes = checkGitHubScopes(["repo"]);
    if (missingScopes.length > 0) {
      console.log(
        ctx.ui.yellow(
          `[oac] Warning: GitHub token missing scope(s): ${missingScopes.join(", ")}. Private repos may fail.`,
        ),
      );
      console.log(ctx.ui.yellow("[oac] Fix with: gh auth refresh -s repo"));
    }
  }
}

function printRunHeader(ctx: PipelineContext, totalBudget: number, concurrency: number): void {
  if (ctx.suppressOutput) return;
  console.log(
    ctx.ui.blue(
      `Starting OAC run (budget: ${formatBudgetDisplay(totalBudget)} tokens, concurrency: ${concurrency})`,
    ),
  );
}

export function validateRunOptions(options: RunCommandOptions): void {
  if (typeof options.concurrency === "number" && options.concurrency <= 0) {
    throw new ConfigError("--concurrency must be greater than zero.");
  }

  if (typeof options.timeout === "number" && options.timeout <= 0) {
    throw new ConfigError("--timeout must be greater than zero.");
  }

  if (typeof options.maxTasks === "number" && options.maxTasks <= 0) {
    throw new ConfigError("--max-tasks must be greater than zero when provided.");
  }
}

function resolveMode(modeOption: string | undefined, config: OacConfig | null): RunMode {
  const candidate = (modeOption ?? config?.execution.mode ?? "new-pr").trim();
  if (candidate === "new-pr" || candidate === "update-pr" || candidate === "direct-commit") {
    return candidate;
  }

  throw new ConfigError(`Invalid --mode value "${candidate}".`);
}

function resolveConcurrency(
  concurrencyOption: number | undefined,
  config: OacConfig | null,
): number {
  const configuredConcurrency =
    typeof concurrencyOption === "number"
      ? concurrencyOption
      : (config?.execution.concurrency ?? DEFAULT_CONCURRENCY);

  if (!Number.isFinite(configuredConcurrency) || configuredConcurrency <= 0) {
    throw new ConfigError("Concurrency must be a positive integer.");
  }

  return Math.floor(configuredConcurrency);
}

function resolveTimeout(timeoutOption: number | undefined, config: OacConfig | null): number {
  const configuredTimeout =
    typeof timeoutOption === "number"
      ? timeoutOption
      : (config?.execution.taskTimeout ?? DEFAULT_TIMEOUT_SECONDS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    throw new ConfigError("Timeout must be a positive integer.");
  }

  return Math.floor(configuredTimeout);
}
