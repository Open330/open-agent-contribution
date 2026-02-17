import { randomUUID } from "node:crypto";

import chalk, { Chalk, type ChalkInstance } from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { execa } from "execa";
import ora, { type Ora } from "ora";
import {
  buildEpicExecutionPlan,
  buildExecutionPlan,
  estimateEpicTokens,
  estimateTokens,
} from "../../budget/index.js";
import {
  type Epic,
  type OacConfig,
  type Task,
  type TokenEstimate,
  UNLIMITED_BUDGET,
  createEventBus,
} from "../../core/index.js";
import {
  CompositeScanner,
  GitHubIssuesScanner,
  LintScanner,
  type Scanner,
  TestGapScanner,
  TodoScanner,
  analyzeCodebase,
  createBacklog,
  getPendingEpics,
  groupFindingsIntoEpics,
  isContextStale,
  loadBacklog,
  loadContext,
  persistBacklog,
  persistContext,
  rankTasks,
  updateBacklog,
} from "../../discovery/index.js";
import {
  type AgentProvider,
  ClaudeCodeAdapter,
  CodexAdapter,
  createSandbox,
  epicAsTask,
  executeTask as workerExecuteTask,
} from "../../execution/index.js";
import { cloneRepo, resolveRepo } from "../../repo/index.js";
import { type ContributionLog, writeContributionLog } from "../../tracking/index.js";

import type { GlobalCliOptions } from "../cli.js";
import { loadOptionalConfigFile } from "../config-loader.js";
import { checkGitHubScopes, ensureGitHubAuth } from "../github-auth.js";

interface RunCommandOptions {
  repo?: string;
  tokens?: number;
  provider?: string;
  concurrency?: number;
  dryRun?: boolean;
  mode?: string;
  maxTasks?: number;
  timeout?: number;
  source?: string;
}

interface SandboxInfo {
  branchName: string;
  sandboxPath: string;
  cleanup: () => Promise<void>;
}

type RunMode = "new-pr" | "update-pr" | "direct-commit";
type SupportedScanner = "lint" | "todo" | "github-issues" | "test-gap";
type CompletionStatus = "success" | "partial" | "failed";

interface ExecutionOutcome {
  success: boolean;
  exitCode: number;
  totalTokensUsed: number;
  filesChanged: string[];
  duration: number;
  error?: string;
}

interface TaskRunResult {
  task: Task;
  estimate: TokenEstimate;
  execution: ExecutionOutcome;
  sandbox?: SandboxInfo;
  pr?: {
    number: number;
    url: string;
    status: "open" | "merged" | "closed";
  };
}

interface RunSummaryOutput {
  runId: string;
  repo: string;
  provider: string;
  dryRun: boolean;
  selectedTasks: number;
  deferredTasks: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsCreated: number;
  tokensUsed: number;
  tokensBudgeted: number;
  logPath?: string;
}

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_CONCURRENCY = 2;

export function createRunCommand(): Command {
  const command = new Command("run");

  command
    .description("Run the full OAC pipeline")
    .option("--repo <owner/repo>", "Target repository (owner/repo or GitHub URL)")
    .option("--tokens <value>", 'Token budget (number or "unlimited")', parseTokens)
    .option("--provider <id>", "Agent provider id")
    .option("--concurrency <number>", "Maximum parallel task executions", parseInteger)
    .option("--dry-run", "Show plan without executing tasks", false)
    .option("--mode <mode>", "Execution mode: new-pr|update-pr|direct-commit")
    .option("--max-tasks <number>", "Maximum number of discovered tasks to consider", parseInteger)
    .option("--timeout <seconds>", "Per-task timeout in seconds", parseInteger)
    .option("--source <source>", "Filter tasks by source: lint, todo, github-issue, test-gap")
    .action(async (options: RunCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      validateRunOptions(options);
      await runPipeline(options, globalOptions, ui);
    });

  return command;
}

interface PipelineContext {
  options: RunCommandOptions;
  globalOptions: Required<GlobalCliOptions>;
  ui: ChalkInstance;
  outputJson: boolean;
  runId: string;
  runStartedAt: number;
}

async function runPipeline(
  options: RunCommandOptions,
  globalOptions: Required<GlobalCliOptions>,
  ui: ChalkInstance,
): Promise<void> {
  const ctx: PipelineContext = {
    options,
    globalOptions,
    ui,
    outputJson: globalOptions.json,
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

  const resolveSpinner = createSpinner(ctx.outputJson, "Resolving repository...");
  const resolvedRepo = await resolveRepo(repoInput);
  resolveSpinner?.succeed(`Resolved ${resolvedRepo.fullName}`);

  const cloneSpinner = createSpinner(ctx.outputJson, "Preparing local clone...");
  await cloneRepo(resolvedRepo);
  cloneSpinner?.succeed(`Repository ready at ${resolvedRepo.localPath}`);

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
    // ── Epic-based execution path ──
    await runEpicPipeline(ctx, {
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
}

function printGitHubAuthWarnings(ctx: PipelineContext, ghToken: string | undefined): void {
  if (ctx.outputJson) return;

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
  if (ctx.outputJson) return;
  console.log(
    ctx.ui.blue(
      `Starting OAC run (budget: ${formatBudgetDisplay(totalBudget)} tokens, concurrency: ${concurrency})`,
    ),
  );
}

// ── Epic-based execution ────────────────────────────────────

async function tryLoadOrAnalyzeEpics(
  ctx: PipelineContext,
  params: {
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    config: OacConfig | null;
    ghToken: string | undefined;
    autoAnalyze: boolean;
    contextDir: string;
    staleAfterMs: number;
  },
): Promise<Epic[] | null> {
  const { resolvedRepo, config, ghToken, contextDir, staleAfterMs } = params;

  // Try loading existing backlog first
  const existingBacklog = await loadBacklog(resolvedRepo.localPath, contextDir);
  if (existingBacklog) {
    const pending = getPendingEpics(existingBacklog);
    if (pending.length > 0) {
      // Verify context is not stale
      const context = await loadContext(resolvedRepo.localPath, contextDir);
      if (context && !isContextStale(context.codebaseMap, staleAfterMs)) {
        if (!ctx.outputJson) {
          console.log(ctx.ui.blue(`[oac] Loaded ${pending.length} pending epic(s) from backlog.`));
        }
        return pending;
      }
    }
  }

  // No fresh backlog — auto-analyze if enabled
  if (!params.autoAnalyze) {
    return null;
  }

  const analyzeSpinner = createSpinner(ctx.outputJson, "Auto-analyzing codebase...");

  const scanners = buildScannerList(config, Boolean(ghToken));
  const { codebaseMap, qualityReport } = await analyzeCodebase(resolvedRepo.localPath, {
    scanners,
    repoFullName: resolvedRepo.fullName,
    headSha: resolvedRepo.git.headSha,
    exclude: config?.discovery.exclude,
  });

  analyzeSpinner?.succeed(
    `Analyzed ${codebaseMap.modules.length} modules, ${codebaseMap.totalFiles} files, ${qualityReport.findings.length} findings`,
  );

  if (qualityReport.findings.length === 0) {
    return null;
  }

  const groupSpinner = createSpinner(ctx.outputJson, "Grouping findings into epics...");
  const epics = groupFindingsIntoEpics(qualityReport.findings, { codebaseMap });
  groupSpinner?.succeed(`Created ${epics.length} epic(s)`);

  // Persist context and backlog
  const persistSpinner = createSpinner(ctx.outputJson, "Persisting context...");
  await persistContext(resolvedRepo.localPath, codebaseMap, qualityReport, contextDir);
  const backlog = createBacklog(resolvedRepo.fullName, resolvedRepo.git.headSha, epics);
  await persistBacklog(resolvedRepo.localPath, backlog, contextDir);
  persistSpinner?.succeed(`Context persisted to ${contextDir}/`);

  return getPendingEpics(backlog);
}

function buildScannerList(config: OacConfig | null, hasGitHubAuth: boolean): Scanner[] {
  const scanners: Scanner[] = [];
  if (config?.discovery.scanners.lint !== false) scanners.push(new LintScanner());
  if (config?.discovery.scanners.todo !== false) scanners.push(new TodoScanner());
  scanners.push(new TestGapScanner());
  if (hasGitHubAuth) scanners.push(new GitHubIssuesScanner());
  return scanners;
}

function makeStubEstimate(taskId: string, providerId: string, tokens: number): TokenEstimate {
  return {
    taskId,
    providerId,
    contextTokens: 0,
    promptTokens: 0,
    expectedOutputTokens: 0,
    totalEstimatedTokens: tokens,
    confidence: 0.7,
    feasible: true,
  };
}

async function executeEpicEntry(
  entry: { epic: Epic; estimatedTokens: number },
  params: {
    adapter: AgentProvider | null;
    useRealExecution: boolean;
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    providerId: string;
    timeoutSeconds: number;
    mode: RunMode;
    ghToken?: string;
  },
): Promise<TaskRunResult> {
  const { adapter, useRealExecution, resolvedRepo, providerId, timeoutSeconds, mode, ghToken } =
    params;
  const task = epicAsTask(entry.epic);
  const estimate = makeStubEstimate(task.id, providerId, entry.estimatedTokens);

  let execution: ExecutionOutcome;
  let sandbox: SandboxInfo | undefined;

  if (useRealExecution && adapter) {
    const result = await executeWithAgent({
      task,
      estimate,
      adapter,
      repoPath: resolvedRepo.localPath,
      baseBranch: resolvedRepo.meta.defaultBranch,
      timeoutSeconds,
    });
    execution = result.execution;
    sandbox = result.sandbox;
  } else {
    execution = await simulateExecution(task, estimate);
  }

  let pr: TaskRunResult["pr"];
  if (mode !== "direct-commit" && execution.success && sandbox) {
    pr =
      (await createPullRequest({
        task,
        execution,
        sandbox,
        repoFullName: resolvedRepo.fullName,
        baseBranch: resolvedRepo.meta.defaultBranch,
        ghToken,
      })) ?? undefined;
  }

  return { task, estimate, execution, sandbox, pr };
}

async function runEpicPipeline(
  ctx: PipelineContext,
  params: {
    epics: Epic[];
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    config: OacConfig | null;
    providerId: string;
    totalBudget: number;
    concurrency: number;
    timeoutSeconds: number;
    mode: RunMode;
    ghToken?: string;
    contextDir: string;
  },
): Promise<void> {
  const {
    epics,
    resolvedRepo,
    providerId,
    totalBudget,
    timeoutSeconds,
    mode,
    ghToken,
    contextDir,
  } = params;

  // Estimate tokens for each epic
  const estimateSpinner = createSpinner(
    ctx.outputJson,
    `Estimating tokens for ${epics.length} epic(s)...`,
  );
  for (const epic of epics) {
    if (epic.estimatedTokens === 0) {
      epic.estimatedTokens = await estimateEpicTokens(epic, providerId);
    }
  }
  estimateSpinner?.succeed("Epic token estimation completed");

  const epicPlan = buildEpicExecutionPlan(epics, totalBudget);

  if (!ctx.outputJson) {
    console.log(
      ctx.ui.blue(
        `[oac] Selected ${epicPlan.selectedEpics.length} epic(s) for execution, ${epicPlan.deferredEpics.length} deferred.`,
      ),
    );
  }

  if (ctx.options.dryRun) {
    printEpicDryRun(ctx, epicPlan, totalBudget);
    return;
  }

  // Execute each selected epic
  const { adapter, useRealExecution } = await resolveAdapter(providerId);
  const allTaskResults: TaskRunResult[] = [];

  for (const entry of epicPlan.selectedEpics) {
    if (!ctx.outputJson) {
      console.log(
        ctx.ui.blue(
          `\n[oac] Executing epic: ${entry.epic.title} (${entry.epic.subtasks.length} subtasks)`,
        ),
      );
    }

    const result = await executeEpicEntry(entry, {
      adapter,
      useRealExecution,
      resolvedRepo,
      providerId,
      timeoutSeconds,
      mode,
      ghToken,
    });
    allTaskResults.push(result);

    if (!ctx.outputJson) {
      const icon = result.execution.success ? ctx.ui.green("[OK]") : ctx.ui.red("[X]");
      console.log(`${icon} ${entry.epic.title}`);
      if (result.pr) console.log(`    PR #${result.pr.number}: ${result.pr.url}`);
    }
  }

  // Update backlog with completed epics
  const completedIds = allTaskResults.filter((r) => r.execution.success).map((r) => r.task.id);
  const existingBacklog = await loadBacklog(resolvedRepo.localPath, contextDir);
  if (existingBacklog && completedIds.length > 0) {
    const updated = updateBacklog(existingBacklog, [], completedIds);
    await persistBacklog(resolvedRepo.localPath, updated, contextDir);
  }

  await writeTracking(ctx, {
    resolvedRepo,
    providerId,
    totalBudget,
    candidateTasks: allTaskResults.map((r) => r.task),
    completedTasks: allTaskResults,
  });

  printEpicSummary(ctx, epicPlan, allTaskResults, resolvedRepo.fullName, providerId, totalBudget);
}

function printEpicDryRun(
  ctx: PipelineContext,
  epicPlan: ReturnType<typeof buildEpicExecutionPlan>,
  totalBudget: number,
): void {
  if (ctx.outputJson) {
    console.log(
      JSON.stringify(
        { summary: { runId: ctx.runId, dryRun: true, epics: epicPlan }, plan: epicPlan },
        null,
        2,
      ),
    );
  } else {
    renderEpicPlanTable(ctx.ui, epicPlan, totalBudget);
    console.log("");
    console.log(ctx.ui.blue("Dry run complete. No epics were executed."));
  }
}

function printEpicSummary(
  ctx: PipelineContext,
  epicPlan: ReturnType<typeof buildEpicExecutionPlan>,
  results: TaskRunResult[],
  repoName: string,
  providerId: string,
  totalBudget: number,
): void {
  const completed = results.filter((t) => t.execution.success).length;
  const failed = results.length - completed;
  const prsCreated = results.filter((t) => Boolean(t.pr)).length;
  const tokensUsed = results.reduce((sum, t) => sum + t.execution.totalTokensUsed, 0);
  const duration = (Date.now() - ctx.runStartedAt) / 1000;

  if (ctx.outputJson) {
    console.log(
      JSON.stringify(
        {
          summary: {
            runId: ctx.runId,
            repo: repoName,
            provider: providerId,
            dryRun: false,
            selectedEpics: epicPlan.selectedEpics.length,
            deferredEpics: epicPlan.deferredEpics.length,
            epicsCompleted: completed,
            epicsFailed: failed,
            prsCreated,
            tokensUsed,
            tokensBudgeted: totalBudget,
          },
          epics: results,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("");
  console.log(ctx.ui.bold("Run Summary (Epic Mode)"));
  console.log(`  Epics completed: ${completed}/${results.length}`);
  console.log(`  Epics failed:    ${failed}`);
  console.log(`  PRs created:     ${prsCreated}`);
  console.log(
    `  Tokens used:     ${formatInteger(tokensUsed)} / ${formatBudgetDisplay(totalBudget)}`,
  );
  console.log(`  Duration:        ${formatDuration(duration)}`);
}

function renderEpicPlanTable(
  ui: ChalkInstance,
  plan: ReturnType<typeof buildEpicExecutionPlan>,
  budget: number,
): void {
  const table = new Table({
    head: ["#", "Epic", "Scope", "Subtasks", "Est. Tokens", "Priority"],
  });

  for (let i = 0; i < plan.selectedEpics.length; i++) {
    const entry = plan.selectedEpics[i];
    table.push([
      String(i + 1),
      truncate(entry.epic.title, 45),
      entry.epic.scope,
      String(entry.epic.subtasks.length),
      formatInteger(entry.estimatedTokens),
      String(entry.epic.priority),
    ]);
  }

  if (plan.selectedEpics.length > 0) {
    console.log(table.toString());
  } else {
    console.log(ui.yellow("No epics selected for execution."));
  }

  if (plan.deferredEpics.length > 0) {
    console.log("");
    console.log(ui.yellow(`Deferred (${plan.deferredEpics.length}):`));
    for (const deferred of plan.deferredEpics) {
      console.log(
        `  - ${truncate(deferred.epic.title, 60)} (${formatInteger(deferred.estimatedTokens)} tokens)`,
      );
    }
  }
}

// ── Task-based execution (fallback) ────────────────────────

async function discoverTasks(
  ctx: PipelineContext,
  options: RunCommandOptions,
  config: OacConfig | null,
  ghToken: string | undefined,
  resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>,
) {
  const scannerSelection = selectScannersFromConfig(config, Boolean(ghToken));
  const minPriority = config?.discovery.minPriority ?? 20;
  const maxTasks = options.maxTasks ?? undefined;

  const scanSpinner = createSpinner(
    ctx.outputJson,
    `Running scanners: ${scannerSelection.enabled.join(", ")}`,
  );
  const scannedTasks = await scannerSelection.scanner.scan(resolvedRepo.localPath, {
    exclude: config?.discovery.exclude,
    maxTasks: config?.discovery.maxTasks,
    repo: resolvedRepo,
  });
  scanSpinner?.succeed(`Discovered ${scannedTasks.length} raw task(s)`);

  let candidateTasks = rankTasks(scannedTasks).filter((task) => task.priority >= minPriority);
  if (options.source) {
    candidateTasks = candidateTasks.filter((task) => task.source === options.source);
  }
  if (typeof maxTasks === "number") {
    candidateTasks = candidateTasks.slice(0, maxTasks);
  }

  const estimateSpinner = createSpinner(
    ctx.outputJson,
    `Estimating tokens for ${candidateTasks.length} task(s)...`,
  );
  const estimates =
    candidateTasks.length > 0
      ? await estimateTaskMap(candidateTasks, resolveProviderId(options.provider, config))
      : new Map<string, TokenEstimate>();
  if (candidateTasks.length > 0) estimateSpinner?.succeed("Token estimation completed");
  else estimateSpinner?.stop();

  const plan = buildExecutionPlan(candidateTasks, estimates, resolveBudget(options.tokens, config));

  return { ...resolvedRepo, candidateTasks, plan, fullName: resolvedRepo.fullName };
}

function printEmptySummary(
  ctx: PipelineContext,
  repoName: string,
  providerId: string,
  totalBudget: number,
): void {
  const emptySummary: RunSummaryOutput = {
    runId: ctx.runId,
    repo: repoName,
    provider: providerId,
    dryRun: Boolean(ctx.options.dryRun),
    selectedTasks: 0,
    deferredTasks: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    prsCreated: 0,
    tokensUsed: 0,
    tokensBudgeted: totalBudget,
  };

  if (ctx.outputJson) {
    console.log(JSON.stringify({ summary: emptySummary, plan: null }, null, 2));
  } else {
    console.log(ctx.ui.yellow("No tasks discovered for execution."));
  }
}

function printDryRunSummary(
  ctx: PipelineContext,
  repoName: string,
  providerId: string,
  totalBudget: number,
  plan: ReturnType<typeof buildExecutionPlan>,
): void {
  const dryRunSummary: RunSummaryOutput = {
    runId: ctx.runId,
    repo: repoName,
    provider: providerId,
    dryRun: true,
    selectedTasks: plan.selectedTasks.length,
    deferredTasks: plan.deferredTasks.length,
    tasksCompleted: 0,
    tasksFailed: 0,
    prsCreated: 0,
    tokensUsed: 0,
    tokensBudgeted: totalBudget,
  };

  if (ctx.outputJson) {
    console.log(JSON.stringify({ summary: dryRunSummary, plan }, null, 2));
  } else {
    renderSelectedPlanTable(ctx.ui, plan, totalBudget);
    console.log("");
    console.log(ctx.ui.blue("Dry run complete. No tasks were executed."));
  }
}

async function executePlan(
  ctx: PipelineContext,
  params: {
    plan: ReturnType<typeof buildExecutionPlan>;
    providerId: string;
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    concurrency: number;
    timeoutSeconds: number;
    mode: RunMode;
    ghToken?: string;
  },
): Promise<TaskRunResult[]> {
  const { plan, providerId, resolvedRepo, concurrency, timeoutSeconds, mode, ghToken } = params;
  const { adapter, useRealExecution } = await resolveAdapter(providerId);

  if (!ctx.outputJson && ctx.globalOptions.verbose) {
    if (useRealExecution && adapter) {
      const avail = await adapter.checkAvailability();
      console.log(
        ctx.ui.green(`[oac] Using ${adapter.name} v${avail.version ?? "unknown"} for execution.`),
      );
    } else {
      console.log(ctx.ui.yellow("[oac] No agent CLI available. Using simulated execution."));
    }
  }

  const executionSpinner = createSpinner(
    ctx.outputJson,
    `Executing ${plan.selectedTasks.length} planned task(s)...`,
  );
  let completedCount = 0;

  const executedTasks = await runWithConcurrency(
    plan.selectedTasks,
    concurrency,
    async (entry): Promise<TaskRunResult> => {
      let execution: ExecutionOutcome;
      let sandbox: SandboxInfo | undefined;

      if (useRealExecution && adapter) {
        const result = await executeWithAgent({
          task: entry.task,
          estimate: entry.estimate,
          adapter,
          repoPath: resolvedRepo.localPath,
          baseBranch: resolvedRepo.meta.defaultBranch,
          timeoutSeconds,
        });
        execution = result.execution;
        sandbox = result.sandbox;
      } else {
        execution = await simulateExecution(entry.task, entry.estimate);
      }

      completedCount += 1;
      if (executionSpinner) {
        executionSpinner.text = `Executing tasks... (${completedCount}/${plan.selectedTasks.length})`;
      }

      return { task: entry.task, estimate: entry.estimate, execution, sandbox };
    },
  );

  executionSpinner?.succeed("Execution stage finished");

  const completionSpinner = createSpinner(ctx.outputJson, "Completing task outputs...");
  const completedTasks = await runWithConcurrency(
    executedTasks,
    concurrency,
    async (result): Promise<TaskRunResult> => {
      if (mode === "direct-commit" || !result.execution.success) return result;

      const pr = await createPullRequest({
        task: result.task,
        execution: result.execution,
        sandbox: result.sandbox,
        repoFullName: resolvedRepo.fullName,
        baseBranch: resolvedRepo.meta.defaultBranch,
        ghToken,
      });

      return pr ? { ...result, pr } : result;
    },
  );
  completionSpinner?.succeed("Completion stage finished");

  return completedTasks;
}

async function writeTracking(
  ctx: PipelineContext,
  params: {
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    providerId: string;
    totalBudget: number;
    candidateTasks: Task[];
    completedTasks: TaskRunResult[];
  },
): Promise<string | undefined> {
  const { resolvedRepo, providerId, totalBudget, candidateTasks, completedTasks } = params;
  const runDurationSeconds = (Date.now() - ctx.runStartedAt) / 1000;

  const contributionLog = buildContributionLog({
    runId: ctx.runId,
    repoFullName: resolvedRepo.fullName,
    repoHeadSha: resolvedRepo.git.headSha,
    defaultBranch: resolvedRepo.meta.defaultBranch,
    repoOwner: resolvedRepo.owner,
    providerId,
    totalBudget,
    runDurationSeconds,
    discoveredTasks: candidateTasks.length,
    taskResults: completedTasks,
  });

  const trackingSpinner = createSpinner(ctx.outputJson, "Writing contribution log...");
  try {
    const logPath = await writeContributionLog(contributionLog, resolvedRepo.localPath);
    trackingSpinner?.succeed(`Contribution log written: ${logPath}`);
    return logPath;
  } catch (error) {
    trackingSpinner?.fail("Failed to write contribution log");
    if (ctx.globalOptions.verbose && !ctx.outputJson) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(ctx.ui.yellow(`[oac] Tracking failed: ${message}`));
    }
    return undefined;
  }
}

function printFinalSummary(
  ctx: PipelineContext,
  params: {
    plan: ReturnType<typeof buildExecutionPlan>;
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    providerId: string;
    totalBudget: number;
    completedTasks: TaskRunResult[];
    logPath?: string;
  },
): void {
  const { plan, resolvedRepo, providerId, totalBudget, completedTasks } = params;
  const tasksCompleted = completedTasks.filter((t) => t.execution.success).length;
  const tasksFailed = completedTasks.length - tasksCompleted;
  const prsCreated = completedTasks.filter((t) => Boolean(t.pr)).length;
  const tokensUsed = completedTasks.reduce((sum, t) => sum + t.execution.totalTokensUsed, 0);
  const runDurationSeconds = (Date.now() - ctx.runStartedAt) / 1000;

  const summary: RunSummaryOutput = {
    runId: ctx.runId,
    repo: resolvedRepo.fullName,
    provider: providerId,
    dryRun: false,
    selectedTasks: plan.selectedTasks.length,
    deferredTasks: plan.deferredTasks.length,
    tasksCompleted,
    tasksFailed,
    prsCreated,
    tokensUsed,
    tokensBudgeted: totalBudget,
    logPath: params.logPath,
  };

  if (ctx.outputJson) {
    console.log(JSON.stringify({ summary, plan, tasks: completedTasks }, null, 2));
    return;
  }

  renderTaskResults(ctx.ui, completedTasks);
  console.log("");
  console.log(ctx.ui.bold("Run Summary"));
  console.log(`  Tasks completed: ${tasksCompleted}/${completedTasks.length}`);
  console.log(`  Tasks failed:    ${tasksFailed}`);
  console.log(`  PRs created:     ${prsCreated}`);
  console.log(
    `  Tokens used:     ${formatInteger(tokensUsed)} / ${formatBudgetDisplay(totalBudget)}`,
  );
  console.log(`  Duration:        ${formatDuration(runDurationSeconds)}`);
  if (params.logPath) {
    console.log(`  Log:             ${params.logPath}`);
  }
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

function parseTokens(value: string): number {
  if (value.toLowerCase() === "unlimited") {
    return UNLIMITED_BUDGET;
  }
  return parseInteger(value);
}

function formatBudgetDisplay(budget: number): string {
  if (budget >= UNLIMITED_BUDGET) {
    return "unlimited";
  }
  return formatInteger(budget);
}

function validateRunOptions(options: RunCommandOptions): void {
  if (typeof options.concurrency === "number" && options.concurrency <= 0) {
    throw new Error("--concurrency must be greater than zero.");
  }

  if (typeof options.timeout === "number" && options.timeout <= 0) {
    throw new Error("--timeout must be greater than zero.");
  }

  if (typeof options.maxTasks === "number" && options.maxTasks <= 0) {
    throw new Error("--max-tasks must be greater than zero when provided.");
  }
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

async function resolveAdapter(
  providerId: string,
): Promise<{ adapter: AgentProvider | null; useRealExecution: boolean }> {
  // Normalize legacy ID
  const normalizedId = providerId === "codex-cli" ? "codex" : providerId;

  const adapters: Record<string, () => AgentProvider> = {
    codex: () => new CodexAdapter(),
    "claude-code": () => new ClaudeCodeAdapter(),
  };

  const factory = adapters[normalizedId];
  if (!factory) {
    return { adapter: null, useRealExecution: false };
  }

  const adapter = factory();
  const availability = await adapter.checkAvailability();
  return {
    adapter: availability.available ? adapter : null,
    useRealExecution: availability.available,
  };
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

function resolveMode(modeOption: string | undefined, config: OacConfig | null): RunMode {
  const candidate = (modeOption ?? config?.execution.mode ?? "new-pr").trim();
  if (candidate === "new-pr" || candidate === "update-pr" || candidate === "direct-commit") {
    return candidate;
  }

  throw new Error(`Invalid --mode value "${candidate}".`);
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
    throw new Error("Concurrency must be a positive integer.");
  }

  return Math.floor(configuredConcurrency);
}

function resolveTimeout(timeoutOption: number | undefined, config: OacConfig | null): number {
  const configuredTimeout =
    typeof timeoutOption === "number"
      ? timeoutOption
      : (config?.execution.taskTimeout ?? DEFAULT_TIMEOUT_SECONDS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    throw new Error("Timeout must be a positive integer.");
  }

  return Math.floor(configuredTimeout);
}

function selectScannersFromConfig(
  config: OacConfig | null,
  hasGitHubAuth: boolean,
): {
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

  // Always include test-gap for autonomous code analysis
  enabled.push("test-gap");

  // Include GitHub issues scanner when a GitHub token is available.
  if (hasGitHubAuth) {
    enabled.push("github-issues");
  }

  if (enabled.length === 0) {
    enabled.push("lint", "todo", "test-gap");
  }

  const uniqueEnabled = [...new Set(enabled)];
  const scannerInstances: Scanner[] = uniqueEnabled.map((scannerName) => {
    if (scannerName === "lint") return new LintScanner();
    if (scannerName === "github-issues") return new GitHubIssuesScanner();
    if (scannerName === "test-gap") return new TestGapScanner();
    return new TodoScanner();
  });

  return {
    enabled: uniqueEnabled,
    scanner: new CompositeScanner(scannerInstances),
  };
}

async function estimateTaskMap(
  tasks: Task[],
  providerId: string,
): Promise<Map<string, TokenEstimate>> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const estimate = await estimateTokens(task, providerId);
      return [task.id, estimate] as const;
    }),
  );

  return new Map(entries);
}

async function executeWithAgent(input: {
  task: Task;
  estimate: TokenEstimate;
  adapter: AgentProvider;
  repoPath: string;
  baseBranch: string;
  timeoutSeconds: number;
}): Promise<{ execution: ExecutionOutcome; sandbox: SandboxInfo }> {
  const startedAt = Date.now();
  const taskSlug = input.task.id
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
  const branchName = `oac/${Date.now()}-${taskSlug}`;

  const sandbox = await createSandbox(input.repoPath, branchName, input.baseBranch);
  const eventBus = createEventBus();
  const sandboxInfo: SandboxInfo = {
    branchName,
    sandboxPath: sandbox.path,
    cleanup: sandbox.cleanup,
  };

  try {
    const result = await workerExecuteTask(input.adapter, input.task, sandbox, eventBus, {
      tokenBudget: input.estimate.totalEstimatedTokens,
      timeoutMs: input.timeoutSeconds * 1_000,
    });

    // Agent may edit files without committing — stage and commit any changes
    const commitResult = await commitSandboxChanges(sandbox.path, input.task);

    const filesChanged =
      commitResult.filesChanged.length > 0
        ? commitResult.filesChanged
        : result.filesChanged.length > 0
          ? result.filesChanged
          : [];

    return {
      execution: {
        success: result.success || commitResult.hasChanges,
        exitCode: result.exitCode,
        totalTokensUsed: result.totalTokensUsed,
        filesChanged,
        duration: result.duration > 0 ? result.duration / 1_000 : (Date.now() - startedAt) / 1_000,
        error: result.error,
      },
      sandbox: sandboxInfo,
    };
  } catch (error) {
    // Even on error, check if agent left uncommitted changes
    const commitResult = await commitSandboxChanges(sandbox.path, input.task);
    if (commitResult.hasChanges) {
      return {
        execution: {
          success: true,
          exitCode: 0,
          totalTokensUsed: 0,
          filesChanged: commitResult.filesChanged,
          duration: (Date.now() - startedAt) / 1_000,
        },
        sandbox: sandboxInfo,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      execution: {
        success: false,
        exitCode: 1,
        totalTokensUsed: 0,
        filesChanged: [],
        duration: (Date.now() - startedAt) / 1_000,
        error: message,
      },
      sandbox: sandboxInfo,
    };
  }
}

async function createPullRequest(input: {
  task: Task;
  execution: ExecutionOutcome;
  sandbox?: SandboxInfo;
  repoFullName: string;
  baseBranch: string;
  ghToken?: string;
}): Promise<
  | {
      number: number;
      url: string;
      status: "open" | "merged" | "closed";
    }
  | undefined
> {
  if (!input.sandbox) {
    return undefined;
  }

  const { branchName, sandboxPath } = input.sandbox;
  const [owner, repo] = input.repoFullName.split("/");

  try {
    // Build env with explicit GitHub token to avoid interactive device flow
    const ghEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    if (input.ghToken) {
      ghEnv.GH_TOKEN = input.ghToken;
      ghEnv.GITHUB_TOKEN = input.ghToken;
    }

    // Push the branch from the sandbox worktree
    await execa("git", ["push", "--set-upstream", "origin", branchName], {
      cwd: sandboxPath,
      env: ghEnv,
    });

    // Create PR using gh CLI
    const prTitle = `[OAC] ${input.task.title}`;
    const prBodyLines = [
      "## Summary",
      "",
      input.task.description || `Automated contribution for task "${input.task.title}".`,
      "",
    ];

    // Auto-resolve: link PR to GitHub issue so it closes on merge
    if (input.task.linkedIssue) {
      prBodyLines.push(`Closes #${input.task.linkedIssue.number}`, "");
    }

    prBodyLines.push(
      "## Context",
      "",
      `- **Task source:** ${input.task.source}`,
      `- **Complexity:** ${input.task.complexity}`,
      `- **Tokens used:** ${input.execution.totalTokensUsed}`,
      `- **Files changed:** ${input.execution.filesChanged.length}`,
    );

    if (input.task.linkedIssue) {
      prBodyLines.push(`- **Resolves:** #${input.task.linkedIssue.number}`);
    }

    prBodyLines.push(
      "",
      "---",
      "*This PR was automatically generated by [OAC](https://github.com/Open330/open-agent-contribution).*",
    );

    const prBody = prBodyLines.join("\n");

    const ghResult = await execa(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        input.repoFullName,
        "--title",
        prTitle,
        "--body",
        prBody,
        "--head",
        branchName,
        "--base",
        input.baseBranch,
      ],
      { cwd: sandboxPath, env: ghEnv },
    );

    // Parse PR URL from gh output
    const prUrl = ghResult.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? Number.parseInt(prNumberMatch[1], 10) : 0;

    return {
      number: prNumber,
      url: prUrl,
      status: "open",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[oac] PR creation failed: ${message}`);
    return undefined;
  }
}

async function simulateExecution(task: Task, estimate: TokenEstimate): Promise<ExecutionOutcome> {
  const start = Date.now();
  const delayMs = Math.min(1_500, Math.max(150, Math.round(estimate.totalEstimatedTokens / 40)));
  await sleep(delayMs);

  return {
    success: true,
    exitCode: 0,
    totalTokensUsed: Math.max(1, Math.round(estimate.totalEstimatedTokens * 0.9)),
    filesChanged:
      task.targetFiles.length > 0
        ? task.targetFiles.slice(0, Math.min(task.targetFiles.length, 4))
        : [],
    duration: (Date.now() - start) / 1_000,
  };
}

async function commitSandboxChanges(
  sandboxPath: string,
  task: Task,
): Promise<{ hasChanges: boolean; filesChanged: string[] }> {
  try {
    // Check for any uncommitted changes (staged + unstaged + untracked)
    const statusResult = await execa("git", ["status", "--porcelain"], { cwd: sandboxPath });
    if (!statusResult.stdout.trim()) {
      return { hasChanges: false, filesChanged: [] };
    }

    await execa("git", ["add", "-A"], { cwd: sandboxPath });
    await execa(
      "git",
      ["commit", "-m", `[OAC] ${task.title}\n\nAutomated contribution by OAC using Codex CLI.`],
      { cwd: sandboxPath },
    );

    // Get the list of changed files from the commit
    const diffResult = await execa("git", ["diff", "--name-only", "HEAD~1", "HEAD"], {
      cwd: sandboxPath,
    });
    const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean);

    return { hasChanges: true, filesChanged: changedFiles };
  } catch {
    return { hasChanges: false, filesChanged: [] };
  }
}

function buildContributionLog(input: {
  runId: string;
  repoFullName: string;
  repoHeadSha: string;
  defaultBranch: string;
  repoOwner: string;
  providerId: string;
  totalBudget: number;
  runDurationSeconds: number;
  discoveredTasks: number;
  taskResults: TaskRunResult[];
}): ContributionLog {
  const timestamp = new Date().toISOString();
  const contributor = resolveGithubUsername(input.repoOwner);

  const contributionTasks = input.taskResults.map((result) => ({
    taskId: result.task.id,
    title: result.task.title,
    source: result.task.source,
    complexity: result.task.complexity,
    status: deriveTaskStatus(result.execution),
    tokensUsed: Math.max(0, Math.floor(result.execution.totalTokensUsed)),
    duration: Math.max(0, result.execution.duration),
    filesChanged: result.execution.filesChanged,
    pr: result.pr,
    linkedIssue: result.task.linkedIssue
      ? {
          number: result.task.linkedIssue.number,
          url: result.task.linkedIssue.url,
        }
      : undefined,
    error: result.execution.error,
  }));

  const tasksSucceeded = contributionTasks.filter((task) => task.status !== "failed").length;
  const tasksFailed = contributionTasks.length - tasksSucceeded;
  const totalTokensUsed = contributionTasks.reduce((sum, task) => sum + task.tokensUsed, 0);
  const totalFilesChanged = contributionTasks.reduce(
    (sum, task) => sum + task.filesChanged.length,
    0,
  );

  return {
    version: "1.0",
    runId: input.runId,
    timestamp,
    contributor: {
      githubUsername: contributor,
      email: process.env.GIT_AUTHOR_EMAIL ?? undefined,
    },
    repo: {
      fullName: input.repoFullName,
      headSha: input.repoHeadSha,
      defaultBranch: input.defaultBranch,
    },
    budget: {
      provider: input.providerId,
      totalTokensBudgeted: input.totalBudget,
      totalTokensUsed,
    },
    tasks: contributionTasks,
    metrics: {
      tasksDiscovered: input.discoveredTasks,
      tasksAttempted: contributionTasks.length,
      tasksSucceeded,
      tasksFailed,
      totalDuration: Math.max(0, input.runDurationSeconds),
      totalFilesChanged,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
  };
}

function deriveTaskStatus(execution: ExecutionOutcome): CompletionStatus {
  if (execution.success) {
    return "success";
  }

  if (execution.filesChanged.length > 0) {
    return "partial";
  }

  return "failed";
}

function resolveGithubUsername(fallback: string): string {
  const candidates = [
    process.env.GITHUB_USER,
    process.env.GITHUB_USERNAME,
    process.env.USER,
    process.env.LOGNAME,
    fallback,
    "oac-user",
  ];

  for (const candidate of candidates) {
    const normalized = sanitizeGithubUsername(candidate ?? "");
    if (normalized) {
      return normalized;
    }
  }

  return "oac-user";
}

function sanitizeGithubUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (cleaned.length === 0 || cleaned.length > 39) {
    return null;
  }

  if (!/^(?!-)[A-Za-z0-9-]+(?<!-)$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function renderSelectedPlanTable(
  ui: ChalkInstance,
  plan: ReturnType<typeof buildExecutionPlan>,
  budget: number,
): void {
  const table = new Table({
    head: ["#", "Task", "Est. Tokens", "Cumulative", "Confidence"],
  });

  for (let index = 0; index < plan.selectedTasks.length; index += 1) {
    const entry = plan.selectedTasks[index];
    table.push([
      String(index + 1),
      truncate(entry.task.title, 56),
      formatInteger(entry.estimate.totalEstimatedTokens),
      formatInteger(entry.cumulativeBudgetUsed),
      entry.estimate.confidence.toFixed(2),
    ]);
  }

  if (plan.selectedTasks.length > 0) {
    console.log(table.toString());
  } else {
    console.log(ui.yellow("No tasks selected for execution."));
  }

  console.log("");
  console.log(
    `Budget used: ${formatInteger(
      plan.selectedTasks[plan.selectedTasks.length - 1]?.cumulativeBudgetUsed ?? 0,
    )} / ${formatBudgetDisplay(budget - plan.reserveTokens)} (effective)`,
  );
  console.log(`Reserve:     ${formatBudgetDisplay(plan.reserveTokens)} (10%)`);
  console.log(`Remaining:   ${formatBudgetDisplay(plan.remainingTokens)}`);

  if (plan.deferredTasks.length > 0) {
    console.log("");
    console.log(ui.yellow(`Deferred (${plan.deferredTasks.length}):`));
    for (const deferred of plan.deferredTasks) {
      console.log(
        `  - ${truncate(deferred.task.title, 72)} (${formatInteger(
          deferred.estimate.totalEstimatedTokens,
        )} tokens, ${deferred.reason.replaceAll("_", " ")})`,
      );
    }
  }
}

function renderTaskResults(ui: ChalkInstance, taskResults: TaskRunResult[]): void {
  for (let index = 0; index < taskResults.length; index += 1) {
    const result = taskResults[index];
    const icon = result.execution.success ? ui.green("[OK]") : ui.red("[X]");
    const status = result.execution.success ? ui.green("SUCCESS") : ui.red("FAILED");

    console.log(`${icon} [${index + 1}/${taskResults.length}] ${result.task.title}`);
    console.log(
      `    ${status} | tokens ${formatInteger(result.execution.totalTokensUsed)} | duration ${formatDuration(
        result.execution.duration,
      )}`,
    );
    if (result.pr) {
      console.log(`    PR #${result.pr.number}: ${result.pr.url}`);
    }
    if (result.execution.error) {
      console.log(`    Error: ${result.execution.error}`);
    }
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0s";
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
