import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { execa } from "execa";

import type { Task } from "../../../core/index.js";
import type { ContributionLog } from "../../../tracking/index.js";
import { writeContributionLog } from "../../../tracking/index.js";
import { createSpinner } from "../../helpers.js";
import type {
  CompletionStatus,
  ExecutionOutcome,
  PipelineContext,
  TaskRunResult,
} from "./types.js";

export async function writeTracking(
  ctx: PipelineContext,
  params: {
    resolvedRepo: {
      localPath: string;
      fullName: string;
      git: { headSha: string };
      meta: { defaultBranch: string };
      owner: string;
    };
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

  const trackingSpinner = createSpinner(ctx.suppressOutput, "Writing contribution log...");
  try {
    const logPath = await writeContributionLog(contributionLog, resolvedRepo.localPath);
    trackingSpinner?.succeed(`Contribution log written: ${logPath}`);
    return logPath;
  } catch (error) {
    trackingSpinner?.fail("Failed to write contribution log");
    if (ctx.globalOptions.verbose && !ctx.suppressOutput) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(ctx.ui.yellow(`[oac] Tracking failed: ${message}`));
    }
    return undefined;
  }
}

export function buildContributionLog(input: {
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

export function deriveTaskStatus(execution: ExecutionOutcome): CompletionStatus {
  if (execution.success) {
    return "success";
  }

  if (execution.filesChanged.length > 0) {
    return "partial";
  }

  return "failed";
}

export function resolveGithubUsername(fallback: string): string {
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

export function sanitizeGithubUsername(value: string): string | null {
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

/**
 * Write a per-task contribution metadata file into the sandbox worktree so it
 * gets included in the PR branch.  The file is staged and committed
 * automatically — callers should invoke this **before** `createPullRequest()`.
 */
export async function writeContributionToSandbox(input: {
  sandboxPath: string;
  task: Task;
  execution: ExecutionOutcome;
  runId: string;
  repoFullName: string;
  repoOwner: string;
}): Promise<void> {
  const { sandboxPath, task, execution, runId, repoOwner } = input;

  const contributionsDir = resolve(sandboxPath, ".oac", "contributions");
  await mkdir(contributionsDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const contributor = resolveGithubUsername(repoOwner);
  const datePrefix = timestamp.replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const safeTaskId = task.id
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  const filename = `${datePrefix}-${safeTaskId}.json`;

  const metadata = {
    version: "1.0",
    runId,
    timestamp,
    contributor,
    task: {
      id: task.id,
      title: task.title,
      source: task.source,
      complexity: task.complexity,
      linkedIssue: task.linkedIssue
        ? { number: task.linkedIssue.number, url: task.linkedIssue.url }
        : undefined,
    },
    execution: {
      success: execution.success,
      tokensUsed: execution.totalTokensUsed,
      duration: execution.duration,
      filesChanged: execution.filesChanged,
    },
  };

  const filePath = join(contributionsDir, filename);
  await writeFile(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  try {
    await execa("git", ["add", filePath], { cwd: sandboxPath });
    await execa("git", ["commit", "-m", "[OAC] Add contribution metadata"], { cwd: sandboxPath });
  } catch {
    // If commit fails (e.g. nothing to commit), that's fine — the file is
    // still on disk and will be picked up by any subsequent commit.
  }
}
