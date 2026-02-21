import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { buildExecutionPlan } from "../../../budget/index.js";
import type { Task } from "../../../core/index.js";
import type { resolveRepo } from "../../../repo/index.js";
import {
  type ContributionLog,
  type ContributionTask,
  contributionLogSchema,
} from "../../../tracking/index.js";
import { createSpinner, estimateTaskMap, formatInteger } from "../../helpers.js";
import { executePlan, printFinalSummary } from "./task.js";
import { writeTracking } from "./tracking.js";
import type { PipelineContext, RunMode, TaskRunResult } from "./types.js";

async function readMostRecentContributionLog(
  repoPath: string,
): Promise<ContributionLog | undefined> {
  const contributionsPath = resolve(repoPath, ".oac", "contributions");

  let entries: string[];
  try {
    const dirEntries = await readdir(contributionsPath, { withFileTypes: true, encoding: "utf8" });
    entries = dirEntries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a)); // most recent first (filenames are timestamped)
  } catch {
    return undefined;
  }

  for (const fileName of entries) {
    try {
      const content = await readFile(resolve(contributionsPath, fileName), "utf8");
      const parsed = contributionLogSchema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
    } catch {}
  }

  return undefined;
}

function taskFromContributionEntry(entry: ContributionTask): Task {
  return {
    id: entry.taskId,
    source: entry.source as Task["source"],
    title: entry.title,
    description: `Retry of failed task: ${entry.title}`,
    targetFiles: entry.filesChanged,
    priority: 100, // high priority — user explicitly chose to retry
    complexity: entry.complexity as Task["complexity"],
    executionMode: "new-pr",
    metadata: { retryOf: entry.taskId },
    discoveredAt: new Date().toISOString(),
  };
}

export async function runRetryPipeline(
  ctx: PipelineContext,
  params: {
    resolvedRepo: Awaited<ReturnType<typeof resolveRepo>>;
    providerId: string;
    totalBudget: number;
    concurrency: number;
    timeoutSeconds: number;
    mode: RunMode;
    ghToken?: string;
  },
): Promise<TaskRunResult[]> {
  const { resolvedRepo, providerId, totalBudget, concurrency, timeoutSeconds, mode, ghToken } =
    params;

  const retrySpinner = createSpinner(ctx.suppressOutput, "Loading most recent contribution log...");
  const log = await readMostRecentContributionLog(resolvedRepo.localPath);

  if (!log) {
    retrySpinner?.fail("No contribution logs found in .oac/contributions/");
    if (!ctx.suppressOutput) {
      console.log(
        ctx.ui.yellow("[oac] Run the pipeline at least once before using --retry-failed."),
      );
    }
    return [];
  }

  const failedEntries = log.tasks.filter((t) => t.status === "failed");
  if (failedEntries.length === 0) {
    retrySpinner?.succeed("No failed tasks in the most recent run — nothing to retry.");
    return [];
  }

  retrySpinner?.succeed(
    `Found ${failedEntries.length} failed task(s) from run ${log.runId.slice(0, 8)}`,
  );

  const retryTasks = failedEntries.map(taskFromContributionEntry);
  const estimates = await estimateTaskMap(retryTasks, providerId);
  const plan = buildExecutionPlan(retryTasks, estimates, totalBudget);

  if (plan.selectedTasks.length === 0) {
    if (!ctx.suppressOutput) {
      console.log(ctx.ui.yellow("[oac] No retry tasks could be selected within the budget."));
    }
    return [];
  }

  if (!ctx.suppressOutput) {
    console.log(
      ctx.ui.blue(
        `\n[oac] Retrying ${plan.selectedTasks.length} failed task(s) (budget: ${formatInteger(totalBudget)} tokens)`,
      ),
    );
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
    candidateTasks: retryTasks,
    completedTasks,
  });

  printFinalSummary(ctx, {
    plan,
    resolvedRepo,
    providerId,
    totalBudget,
    completedTasks,
  });

  return completedTasks;
}
