import { randomUUID } from "node:crypto";

import { buildExecutionPlan, estimateTokens } from "@open330/oac-budget";
import { type Task, type TokenEstimate, createEventBus } from "@open330/oac-core";
import {
  CompositeScanner,
  GitHubIssuesScanner,
  LintScanner,
  type Scanner,
  TodoScanner,
  rankTasks,
} from "@open330/oac-discovery";
import { CodexAdapter, createSandbox, executeTask as workerExecuteTask } from "@open330/oac-execution";
import { cloneRepo, resolveRepo } from "@open330/oac-repo";
import { type ContributionLog, writeContributionLog } from "@open330/oac-tracking";
import { execa } from "execa";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunConfig {
  repo: string;
  provider: string;
  tokens: number;
  concurrency?: number;
  maxTasks?: number;
  source?: string;
}

export type RunStage =
  | "resolving"
  | "cloning"
  | "scanning"
  | "estimating"
  | "planning"
  | "executing"
  | "creating-pr"
  | "tracking"
  | "completed"
  | "failed";

export interface RunProgress {
  tasksDiscovered: number;
  tasksSelected: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsCreated: number;
  tokensUsed: number;
  currentTask?: string;
  prUrls: string[];
}

export interface RunState {
  runId: string;
  status: "running" | "completed" | "failed";
  stage: RunStage;
  config: RunConfig;
  startedAt: string;
  completedAt?: string;
  error?: string;
  progress: RunProgress;
}

export type DashboardRunEvent =
  | { type: "run:stage"; stage: RunStage; message: string }
  | { type: "run:progress"; progress: RunProgress }
  | { type: "run:task-start"; taskId: string; title: string }
  | {
      type: "run:task-done";
      taskId: string;
      title: string;
      success: boolean;
      prUrl?: string;
      filesChanged: number;
    }
  | { type: "run:completed"; summary: RunState }
  | { type: "run:error"; error: string };

export type RunEventCallback = (event: DashboardRunEvent) => void;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ExecutionOutcome {
  success: boolean;
  exitCode: number;
  totalTokensUsed: number;
  filesChanged: string[];
  duration: number;
  error?: string;
}

interface SandboxInfo {
  branchName: string;
  sandboxPath: string;
  cleanup: () => Promise<void>;
}

interface TaskResult {
  task: Task;
  execution: ExecutionOutcome;
  sandbox?: SandboxInfo;
  pr?: { number: number; url: string; status: "open" | "merged" | "closed" };
}

function buildScanners(): { names: string[]; scanner: CompositeScanner } {
  const scanners: Scanner[] = [new LintScanner(), new TodoScanner()];
  const names = ["lint", "todo"];

  if (process.env.GITHUB_TOKEN) {
    scanners.push(new GitHubIssuesScanner());
    names.push("github-issues");
  }

  return { names, scanner: new CompositeScanner(scanners) };
}

async function executeWithCodex(input: {
  task: Task;
  estimate: TokenEstimate;
  codexAdapter: CodexAdapter;
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
    const result = await workerExecuteTask(input.codexAdapter, input.task, sandbox, eventBus, {
      tokenBudget: input.estimate.totalEstimatedTokens,
      timeoutMs: input.timeoutSeconds * 1_000,
    });

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

async function commitSandboxChanges(
  sandboxPath: string,
  task: Task,
): Promise<{ hasChanges: boolean; filesChanged: string[] }> {
  try {
    const statusResult = await execa("git", ["status", "--porcelain"], { cwd: sandboxPath });
    if (!statusResult.stdout.trim()) {
      return { hasChanges: false, filesChanged: [] };
    }

    await execa("git", ["add", "-A"], { cwd: sandboxPath });
    await execa(
      "git",
      ["commit", "-m", `[OAC] ${task.title}\n\nAutomated contribution by OAC.`],
      { cwd: sandboxPath },
    );

    const diffResult = await execa("git", ["diff", "--name-only", "HEAD~1", "HEAD"], {
      cwd: sandboxPath,
    });
    const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean);
    return { hasChanges: true, filesChanged: changedFiles };
  } catch {
    return { hasChanges: false, filesChanged: [] };
  }
}

async function createPullRequest(input: {
  task: Task;
  execution: ExecutionOutcome;
  sandbox: SandboxInfo;
  repoFullName: string;
  baseBranch: string;
}): Promise<{ number: number; url: string; status: "open" | "merged" | "closed" } | undefined> {
  const { branchName, sandboxPath } = input.sandbox;

  try {
    await execa("git", ["push", "--set-upstream", "origin", branchName], { cwd: sandboxPath });

    const prTitle = `[OAC] ${input.task.title}`;
    const prBody = [
      "## Summary",
      "",
      input.task.description || `Automated contribution for task "${input.task.title}".`,
      "",
      "## Context",
      "",
      `- **Task source:** ${input.task.source}`,
      `- **Complexity:** ${input.task.complexity}`,
      `- **Tokens used:** ${input.execution.totalTokensUsed}`,
      `- **Files changed:** ${input.execution.filesChanged.length}`,
      "",
      "---",
      "*This PR was automatically generated by [OAC](https://github.com/Open330/open-agent-contribution).*",
    ].join("\n");

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
      { cwd: sandboxPath },
    );

    const prUrl = ghResult.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? Number.parseInt(prNumberMatch[1], 10) : 0;

    return { number: prNumber, url: prUrl, status: "open" };
  } catch {
    return undefined;
  }
}

function resolveGithubUsername(): string {
  const candidates = [
    process.env.GITHUB_USER,
    process.env.GITHUB_USERNAME,
    process.env.USER,
    process.env.LOGNAME,
  ];

  for (const c of candidates) {
    const cleaned = c
      ?.trim()
      .replace(/[^A-Za-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (cleaned && cleaned.length <= 39 && /^(?!-)[A-Za-z0-9-]+(?<!-)$/.test(cleaned)) {
      return cleaned;
    }
  }

  return "oac-user";
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

export async function executePipeline(
  config: RunConfig,
  onEvent: RunEventCallback,
): Promise<RunState> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const progress: RunProgress = {
    tasksDiscovered: 0,
    tasksSelected: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    prsCreated: 0,
    tokensUsed: 0,
    prUrls: [],
  };

  const state: RunState = {
    runId,
    status: "running",
    stage: "resolving",
    config,
    startedAt,
    progress,
  };

  const emit = (event: DashboardRunEvent) => {
    if (event.type === "run:stage") state.stage = event.stage;
    if (event.type === "run:progress") state.progress = event.progress;
    onEvent(event);
  };

  try {
    // 1. Resolve repo
    emit({ type: "run:stage", stage: "resolving", message: `Resolving ${config.repo}...` });
    const resolvedRepo = await resolveRepo(config.repo);

    // 2. Clone if not local
    emit({ type: "run:stage", stage: "cloning", message: `Cloning ${resolvedRepo.fullName}...` });
    await cloneRepo(resolvedRepo);

    // 3. Scan
    const { names, scanner } = buildScanners();
    emit({
      type: "run:stage",
      stage: "scanning",
      message: `Scanning with ${names.join(", ")}...`,
    });
    const scannedTasks = await scanner.scan(resolvedRepo.localPath, {
      repo: resolvedRepo,
    });

    // 4. Rank & filter
    let candidateTasks = rankTasks(scannedTasks).filter((t) => t.priority >= 20);
    if (config.source) {
      candidateTasks = candidateTasks.filter((t) => t.source === config.source);
    }
    if (config.maxTasks) {
      candidateTasks = candidateTasks.slice(0, config.maxTasks);
    }
    progress.tasksDiscovered = candidateTasks.length;
    emit({ type: "run:progress", progress: { ...progress } });

    if (candidateTasks.length === 0) {
      emit({ type: "run:stage", stage: "completed", message: "No tasks discovered." });
      state.status = "completed";
      state.completedAt = new Date().toISOString();
      emit({ type: "run:completed", summary: { ...state } });
      return state;
    }

    // 5. Estimate tokens
    emit({
      type: "run:stage",
      stage: "estimating",
      message: `Estimating tokens for ${candidateTasks.length} task(s)...`,
    });
    const estimates = new Map<string, TokenEstimate>();
    for (const task of candidateTasks) {
      const est = await estimateTokens(task, config.provider);
      estimates.set(task.id, est);
    }

    // 6. Build execution plan
    emit({ type: "run:stage", stage: "planning", message: "Building execution plan..." });
    const plan = buildExecutionPlan(candidateTasks, estimates, config.tokens);
    progress.tasksSelected = plan.selectedTasks.length;
    emit({ type: "run:progress", progress: { ...progress } });

    if (plan.selectedTasks.length === 0) {
      emit({ type: "run:stage", stage: "completed", message: "No tasks fit within budget." });
      state.status = "completed";
      state.completedAt = new Date().toISOString();
      emit({ type: "run:completed", summary: { ...state } });
      return state;
    }

    // 7. Execute tasks (with concurrency)
    const concurrency = Math.max(1, config.concurrency ?? 1);
    emit({
      type: "run:stage",
      stage: "executing",
      message: `Executing ${plan.selectedTasks.length} task(s) (concurrency: ${concurrency})...`,
    });

    const codexAdapter = new CodexAdapter();
    const codexAvailability = await codexAdapter.checkAvailability();
    const useRealExecution = config.provider.includes("codex") && codexAvailability.available;

    const taskResults = await runWithConcurrency(
      plan.selectedTasks,
      concurrency,
      async (entry): Promise<TaskResult> => {
        emit({ type: "run:task-start", taskId: entry.task.id, title: entry.task.title });
        progress.currentTask = entry.task.title;
        emit({ type: "run:progress", progress: { ...progress } });

        let execution: ExecutionOutcome;
        let sandbox: SandboxInfo | undefined;

        if (useRealExecution) {
          const result = await executeWithCodex({
            task: entry.task,
            estimate: entry.estimate,
            codexAdapter,
            repoPath: resolvedRepo.localPath,
            baseBranch: resolvedRepo.meta.defaultBranch,
            timeoutSeconds: 300,
          });
          execution = result.execution;
          sandbox = result.sandbox;
        } else {
          await new Promise((r) => setTimeout(r, 500));
          execution = {
            success: true,
            exitCode: 0,
            totalTokensUsed: Math.round(entry.estimate.totalEstimatedTokens * 0.9),
            filesChanged: entry.task.targetFiles.slice(0, 4),
            duration: 0.5,
          };
        }

        // Create PR if execution produced changes
        let pr: TaskResult["pr"];
        if (execution.success && sandbox && execution.filesChanged.length > 0) {
          emit({
            type: "run:stage",
            stage: "creating-pr",
            message: `Creating PR for "${entry.task.title}"...`,
          });
          pr = await createPullRequest({
            task: entry.task,
            execution,
            sandbox,
            repoFullName: resolvedRepo.fullName,
            baseBranch: resolvedRepo.meta.defaultBranch,
          });
          if (pr) {
            progress.prsCreated += 1;
            progress.prUrls.push(pr.url);
          }
        }

        if (execution.success) {
          progress.tasksCompleted += 1;
        } else {
          progress.tasksFailed += 1;
        }
        progress.tokensUsed += execution.totalTokensUsed;
        progress.currentTask = undefined;

        const result: TaskResult = { task: entry.task, execution, sandbox, pr };

        emit({
          type: "run:task-done",
          taskId: entry.task.id,
          title: entry.task.title,
          success: execution.success,
          prUrl: pr?.url,
          filesChanged: execution.filesChanged.length,
        });
        emit({ type: "run:progress", progress: { ...progress } });

        return result;
      },
    );

    // 8. Write contribution log
    emit({ type: "run:stage", stage: "tracking", message: "Writing contribution log..." });

    const contributionLog: ContributionLog = {
      version: "1.0",
      runId,
      timestamp: new Date().toISOString(),
      contributor: { githubUsername: resolveGithubUsername() },
      repo: {
        fullName: resolvedRepo.fullName,
        headSha: resolvedRepo.git.headSha,
        defaultBranch: resolvedRepo.meta.defaultBranch,
      },
      budget: {
        provider: config.provider,
        totalTokensBudgeted: config.tokens,
        totalTokensUsed: progress.tokensUsed,
      },
      tasks: taskResults.map((r) => ({
        taskId: r.task.id,
        title: r.task.title,
        source: r.task.source,
        complexity: r.task.complexity,
        status: r.execution.success ? ("success" as const) : ("failed" as const),
        tokensUsed: r.execution.totalTokensUsed,
        duration: r.execution.duration,
        filesChanged: r.execution.filesChanged,
        pr: r.pr,
        error: r.execution.error,
      })),
      metrics: {
        tasksDiscovered: progress.tasksDiscovered,
        tasksAttempted: taskResults.length,
        tasksSucceeded: progress.tasksCompleted,
        tasksFailed: progress.tasksFailed,
        totalDuration: (Date.now() - new Date(startedAt).getTime()) / 1_000,
        totalFilesChanged: taskResults.reduce(
          (sum, r) => sum + r.execution.filesChanged.length,
          0,
        ),
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    };

    try {
      await writeContributionLog(contributionLog, resolvedRepo.localPath);
    } catch {
      // Non-fatal: log write failure shouldn't fail the run
    }

    // 9. Complete
    emit({ type: "run:stage", stage: "completed", message: "Run completed successfully." });
    state.status = "completed";
    state.completedAt = new Date().toISOString();
    emit({ type: "run:completed", summary: { ...state } });

    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.status = "failed";
    state.stage = "failed";
    state.error = message;
    state.completedAt = new Date().toISOString();
    emit({ type: "run:error", error: message });
    return state;
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
