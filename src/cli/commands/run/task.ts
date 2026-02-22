import type { ChalkInstance } from "chalk";
import Table from "cli-table3";
import { execa } from "execa";
import PQueue from "p-queue";
import { buildExecutionPlan } from "../../../budget/index.js";
import type { OacConfig, Task, TokenEstimate } from "../../../core/index.js";
import { createEventBus } from "../../../core/index.js";
import { type ScannerName, buildScanners, rankTasks } from "../../../discovery/index.js";
import {
  type AgentProvider,
  adapterRegistry,
  createSandbox,
  executeTask as workerExecuteTask,
} from "../../../execution/index.js";
import type { resolveRepo } from "../../../repo/index.js";
import {
  createSpinner,
  estimateTaskMap,
  formatInteger,
  resolveBudget,
  resolveProviderId,
  truncate,
} from "../../helpers.js";
import { createPullRequest } from "./pr.js";
import type {
  ExecutionOutcome,
  PipelineContext,
  RunCommandOptions,
  RunMode,
  RunSummaryOutput,
  SandboxInfo,
  TaskRunResult,
} from "./types.js";
import { formatBudgetDisplay, formatDuration } from "./types.js";

export async function discoverTasks(
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
    ctx.suppressOutput,
    `Running scanners: ${scannerSelection.enabled.join(", ")}`,
  );
  const scannedTasks = await scannerSelection.scanner.scan(resolvedRepo.localPath, {
    exclude: config?.discovery.exclude,
    maxTasks: config?.discovery.maxTasks,
    issueLabels: config?.discovery.issueLabels,
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
    ctx.suppressOutput,
    `Estimating tokens for ${candidateTasks.length} task(s)...`,
  );
  const estimates =
    candidateTasks.length > 0
      ? await estimateTaskMap(
          candidateTasks,
          resolveProviderId(options.provider, config),
          (done, total) => {
            if (estimateSpinner) {
              const pct = Math.round((done / total) * 100);
              estimateSpinner.text = `Estimating tokens... (${done}/${total} — ${pct}%)`;
            }
          },
        )
      : new Map<string, TokenEstimate>();
  if (candidateTasks.length > 0) estimateSpinner?.succeed("Token estimation completed");
  else estimateSpinner?.stop();

  const plan = buildExecutionPlan(candidateTasks, estimates, resolveBudget(options.tokens, config));

  return { ...resolvedRepo, candidateTasks, plan, fullName: resolvedRepo.fullName };
}

export function printEmptySummary(
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

export function printDryRunSummary(
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
    renderDryRunDiff(ctx.ui, plan);
    console.log(ctx.ui.blue("Dry run complete. No tasks were executed."));
  }
}

function renderDryRunDiff(ui: ChalkInstance, plan: ReturnType<typeof buildExecutionPlan>): void {
  if (plan.selectedTasks.length === 0) return;

  console.log(ui.bold("Planned changes:"));
  console.log("");

  for (const entry of plan.selectedTasks) {
    const { task } = entry;
    const sourceLabel = task.source.replace(/-/g, " ");
    const complexityColor =
      task.complexity === "trivial" || task.complexity === "simple"
        ? ui.green
        : task.complexity === "moderate"
          ? ui.yellow
          : ui.red;

    console.log(`${ui.green("+")} ${ui.bold(task.title)}`);
    console.log(
      `  ${ui.dim(`source: ${sourceLabel}  complexity: `)}${complexityColor(task.complexity)}`,
    );

    if (task.targetFiles.length > 0) {
      for (const file of task.targetFiles.slice(0, 5)) {
        console.log(`  ${ui.yellow("~")} ${file}`);
      }
      if (task.targetFiles.length > 5) {
        console.log(`  ${ui.dim(`  ... and ${task.targetFiles.length - 5} more files`)}`);
      }
    }

    if (task.description) {
      const preview =
        task.description.length > 120 ? `${task.description.slice(0, 117)}...` : task.description;
      console.log(`  ${ui.dim(preview)}`);
    }
    console.log("");
  }
}

export async function executePlan(
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
  const { adapter } = await resolveAdapter(providerId);

  if (!ctx.suppressOutput && ctx.globalOptions.verbose) {
    const avail = await adapter.checkAvailability();
    console.log(
      ctx.ui.green(`[oac] Using ${adapter.name} v${avail.version ?? "unknown"} for execution.`),
    );
  }

  const executionSpinner = createSpinner(
    ctx.suppressOutput,
    `Executing ${plan.selectedTasks.length} planned task(s)...`,
  );
  let completedCount = 0;

  const taskQueue = new PQueue({ concurrency });
  const executedTasks = await Promise.all(
    plan.selectedTasks.map(
      (entry) =>
        taskQueue.add(async (): Promise<TaskRunResult> => {
          const result = await executeWithAgent({
            task: entry.task,
            estimate: entry.estimate,
            adapter,
            repoPath: resolvedRepo.localPath,
            baseBranch: resolvedRepo.meta.defaultBranch,
            timeoutSeconds,
          });
          const { execution, sandbox } = result;

          completedCount += 1;
          if (executionSpinner) {
            const total = plan.selectedTasks.length;
            const pct = Math.round((completedCount / total) * 100);
            executionSpinner.text = `Executing tasks... (${completedCount}/${total} — ${pct}%)`;
          }

          return { task: entry.task, estimate: entry.estimate, execution, sandbox };
        }) as Promise<TaskRunResult>,
    ),
  );

  executionSpinner?.succeed("Execution stage finished");

  const completionSpinner = createSpinner(ctx.suppressOutput, "Completing task outputs...");
  const completionQueue = new PQueue({ concurrency });
  const completedTasks = await Promise.all(
    executedTasks.map(
      (result) =>
        completionQueue.add(async (): Promise<TaskRunResult> => {
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
        }) as Promise<TaskRunResult>,
    ),
  );
  completionSpinner?.succeed("Completion stage finished");

  return completedTasks;
}

export function printFinalSummary(
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

  if (!ctx.globalOptions.quiet) {
    renderTaskResults(ctx.ui, completedTasks);
  }
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

  // Surface failed task details without requiring --verbose
  const failedTasks = completedTasks.filter((t) => !t.execution.success);
  if (failedTasks.length > 0) {
    console.log("");
    console.log(ctx.ui.red(`Failed Tasks (${failedTasks.length}):`));
    for (const t of failedTasks) {
      const reason = t.execution.error ? `: ${truncate(t.execution.error, 120)}` : "";
      console.log(`  ${ctx.ui.red("✗")} ${truncate(t.task.title, 60)}${reason}`);
    }
  }
}

export function selectScannersFromConfig(config: OacConfig | null, hasGitHubAuth: boolean) {
  const { names, composite } = buildScanners(config, hasGitHubAuth);
  return { enabled: names, scanner: composite };
}

export async function executeWithAgent(input: {
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

    // Agent may edit files without committing — stage and commit any changes.
    // Also detects changes the agent committed itself (e.g. Claude Code).
    const commitResult = await commitSandboxChanges(sandbox.path, input.task, input.baseBranch);

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
    const commitResult = await commitSandboxChanges(sandbox.path, input.task, input.baseBranch);
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

async function commitSandboxChanges(
  sandboxPath: string,
  task: Task,
  baseBranch: string,
): Promise<{ hasChanges: boolean; filesChanged: string[] }> {
  try {
    // Stage and commit any uncommitted changes (staged + unstaged + untracked)
    const statusResult = await execa("git", ["status", "--porcelain"], { cwd: sandboxPath });
    if (statusResult.stdout.trim()) {
      await execa("git", ["add", "-A"], { cwd: sandboxPath });
      await execa(
        "git",
        ["commit", "-m", `[OAC] ${task.title}\n\nAutomated contribution by OAC.`],
        { cwd: sandboxPath },
      );
    }

    // Detect ALL changes vs the base branch — covers both OAC-committed and
    // agent-committed changes (e.g. Claude Code with --dangerously-skip-permissions
    // can commit directly during execution).
    const diffResult = await execa(
      "git",
      ["diff", "--name-only", `origin/${baseBranch}`, "HEAD"],
      { cwd: sandboxPath },
    );
    const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean);

    return { hasChanges: changedFiles.length > 0, filesChanged: changedFiles };
  } catch {
    return { hasChanges: false, filesChanged: [] };
  }
}

export async function resolveAdapter(providerId: string): Promise<{ adapter: AgentProvider }> {
  const normalizedId = adapterRegistry.resolveId(providerId);
  const factory = adapterRegistry.get(providerId);

  if (!factory) {
    const supported = adapterRegistry.registeredIds().join(", ");
    throw new Error(
      `Unknown provider "${providerId}". Supported providers: ${supported}.\nRun \`oac doctor\` to check your environment setup.`,
    );
  }

  const adapter = factory();
  const availability = await adapter.checkAvailability();
  if (!availability.available) {
    throw new Error(
      `Agent CLI "${normalizedId}" is not available: ${availability.error ?? "unknown reason"}.\nInstall the ${normalizedId} CLI or switch providers.\nRun \`oac doctor\` for setup instructions.`,
    );
  }

  return { adapter };
}

export function renderSelectedPlanTable(
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

export function renderTaskResults(ui: ChalkInstance, taskResults: TaskRunResult[]): void {
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
