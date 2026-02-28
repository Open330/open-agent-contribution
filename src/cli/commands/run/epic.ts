import type { ChalkInstance } from "chalk";
import Table from "cli-table3";
import PQueue from "p-queue";
import { buildEpicExecutionPlan, estimateEpicTokens } from "../../../budget/index.js";
import type { Epic, OacConfig, TokenEstimate } from "../../../core/index.js";
import {
  analyzeCodebase,
  buildScanners,
  createBacklog,
  getPendingEpics,
  groupFindingsIntoEpics,
  isContextStale,
  loadBacklog,
  loadContext,
  persistBacklog,
  persistContext,
  updateBacklog,
} from "../../../discovery/index.js";
import { epicAsTask } from "../../../execution/index.js";
import type { resolveRepo } from "../../../repo/index.js";
import { createSpinner, formatInteger, truncate } from "../../helpers.js";
import { createPullRequest } from "./pr.js";
import { executeWithAgent, resolveAdapter } from "./task.js";
import { writeTracking } from "./tracking.js";
import type { ContextAck, PipelineContext, RunMode, TaskRunResult } from "./types.js";
import { formatBudgetDisplay, formatDuration } from "./types.js";

export async function tryLoadOrAnalyzeEpics(
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
        if (!ctx.suppressOutput) {
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

  const analyzeSpinner = createSpinner(ctx.suppressOutput, "Auto-analyzing codebase...");

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

  const groupSpinner = createSpinner(ctx.suppressOutput, "Grouping findings into epics...");
  const epics = groupFindingsIntoEpics(qualityReport.findings, { codebaseMap });
  groupSpinner?.succeed(`Created ${epics.length} epic(s)`);

  // Persist context and backlog
  const persistSpinner = createSpinner(ctx.suppressOutput, "Persisting context...");
  await persistContext(resolvedRepo.localPath, codebaseMap, qualityReport, contextDir);
  const backlog = createBacklog(resolvedRepo.fullName, resolvedRepo.git.headSha, epics);
  await persistBacklog(resolvedRepo.localPath, backlog, contextDir);
  persistSpinner?.succeed(`Context persisted to ${contextDir}/`);

  return getPendingEpics(backlog);
}

/** @deprecated Use {@link buildScanners} from discovery/scanner-factory instead. */
export function buildScannerList(config: OacConfig | null, hasGitHubAuth: boolean) {
  return buildScanners(config, hasGitHubAuth).instances;
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
    adapter: import("../../../execution/index.js").AgentProvider;
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    providerId: string;
    timeoutSeconds: number;
    mode: RunMode;
    ghToken?: string;
    contextAck?: ContextAck;
  },
): Promise<TaskRunResult> {
  const { adapter, resolvedRepo, providerId, timeoutSeconds, mode, ghToken, contextAck } = params;
  const task = withContextAck(epicAsTask(entry.epic), contextAck);
  const estimate = makeStubEstimate(task.id, providerId, entry.estimatedTokens);

  const result = await executeWithAgent({
    task,
    estimate,
    adapter,
    repoPath: resolvedRepo.localPath,
    baseBranch: resolvedRepo.meta.defaultBranch,
    timeoutSeconds,
  });
  const { execution, sandbox } = result;

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

export async function runEpicPipeline(
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
): Promise<TaskRunResult[]> {
  const {
    epics,
    resolvedRepo,
    providerId,
    totalBudget,
    concurrency,
    timeoutSeconds,
    mode,
    ghToken,
    contextDir,
  } = params;

  // Estimate tokens for each epic
  const estimateSpinner = createSpinner(
    ctx.suppressOutput,
    `Estimating tokens for ${epics.length} epic(s)...`,
  );
  let estimatedCount = 0;
  for (const epic of epics) {
    if (epic.estimatedTokens === 0) {
      epic.estimatedTokens = await estimateEpicTokens(epic, providerId);
    }
    estimatedCount += 1;
    if (estimateSpinner) {
      const pct = Math.round((estimatedCount / epics.length) * 100);
      estimateSpinner.text = `Estimating epic tokens... (${estimatedCount}/${epics.length} — ${pct}%)`;
    }
  }
  estimateSpinner?.succeed("Epic token estimation completed");

  const epicPlan = buildEpicExecutionPlan(epics, totalBudget);

  if (!ctx.suppressOutput) {
    console.log(
      ctx.ui.blue(
        `[oac] Selected ${epicPlan.selectedEpics.length} epic(s) for execution, ${epicPlan.deferredEpics.length} deferred.`,
      ),
    );
  }

  if (ctx.options.dryRun) {
    printEpicDryRun(ctx, epicPlan, totalBudget);
    return [];
  }

  // Execute selected epics concurrently
  const { adapter } = await resolveAdapter(providerId);

  let epicCompletedCount = 0;
  const epicTotal = epicPlan.selectedEpics.length;
  const executionSpinner = createSpinner(ctx.suppressOutput, `Executing ${epicTotal} epic(s)...`);

  const epicQueue = new PQueue({ concurrency });
  const allTaskResults = await Promise.all(
    epicPlan.selectedEpics.map(
      (entry) =>
        epicQueue.add(async (): Promise<TaskRunResult> => {
          if (!ctx.suppressOutput) {
            console.log(
              ctx.ui.blue(
                `\n[oac] Executing epic: ${entry.epic.title} (${entry.epic.subtasks.length} subtasks)`,
              ),
            );
          }

          const result = await executeEpicEntry(entry, {
            adapter,
            resolvedRepo,
            providerId,
            timeoutSeconds,
            mode,
            ghToken,
            contextAck: ctx.contextAck,
          });

          epicCompletedCount += 1;
          if (executionSpinner) {
            const pct = Math.round((epicCompletedCount / epicTotal) * 100);
            executionSpinner.text = `Executing epics... (${epicCompletedCount}/${epicTotal} — ${pct}%)`;
          }

          if (!ctx.suppressOutput) {
            const icon = result.execution.success ? ctx.ui.green("[OK]") : ctx.ui.red("[X]");
            console.log(`${icon} ${entry.epic.title}`);
            if (result.pr) console.log(`    PR #${result.pr.number}: ${result.pr.url}`);
          }

          return result;
        }) as Promise<TaskRunResult>,
    ),
  );
  executionSpinner?.succeed("Epic execution finished");

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

  return allTaskResults;
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

  // Surface failed epic details without requiring --verbose
  const failedEpics = results.filter((t) => !t.execution.success);
  if (failedEpics.length > 0) {
    console.log("");
    console.log(ctx.ui.red(`Failed Epics (${failedEpics.length}):`));
    for (const t of failedEpics) {
      const reason = t.execution.error ? `: ${truncate(t.execution.error, 120)}` : "";
      console.log(`  ${ctx.ui.red("✗")} ${truncate(t.task.title, 60)}${reason}`);
    }
  }
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

function withContextAck(
  task: import("../../../core/index.js").Task,
  contextAck: ContextAck | undefined,
): import("../../../core/index.js").Task {
  if (!contextAck) return task;
  return {
    ...task,
    metadata: {
      ...task.metadata,
      contextAck,
    },
  };
}
