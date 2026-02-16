import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildExecutionPlan, estimateTokens } from '@oac/budget';
import * as completionPackage from '@oac/completion';
import { loadConfig, type OacConfig, type Task, type TokenEstimate } from '@oac/core';
import {
  CompositeScanner,
  LintScanner,
  TodoScanner,
  rankTasks,
  type Scanner,
} from '@oac/discovery';
import * as executionPackage from '@oac/execution';
import { cloneRepo, resolveRepo } from '@oac/repo';
import { writeContributionLog, type ContributionLog } from '@oac/tracking';
import chalk, { Chalk } from 'chalk';
import Table from 'cli-table3';
import { Command } from 'commander';
import ora, { type Ora } from 'ora';

import type { GlobalCliOptions } from '../cli.js';

interface RunCommandOptions {
  repo?: string;
  tokens?: number;
  provider?: string;
  concurrency?: number;
  dryRun?: boolean;
  mode?: string;
  maxTasks?: number;
  timeout?: number;
}

type RunMode = 'new-pr' | 'update-pr' | 'direct-commit';
type SupportedScanner = 'lint' | 'todo';
type CompletionStatus = 'success' | 'partial' | 'failed';

type ExecutionHook = (input: {
  task: Task;
  estimate: TokenEstimate;
  provider: string;
  mode: RunMode;
  timeoutSeconds: number;
}) => Promise<unknown>;

type CompletionHook = (input: {
  task: Task;
  execution: ExecutionOutcome;
  repoFullName: string;
  mode: RunMode;
}) => Promise<unknown>;

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
  pr?: {
    number: number;
    url: string;
    status: 'open' | 'merged' | 'closed';
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
  const command = new Command('run');

  command
    .description('Run the full OAC pipeline')
    .option('--repo <owner/repo>', 'Target repository (owner/repo or GitHub URL)')
    .option('--tokens <number>', 'Token budget for execution', parseInteger)
    .option('--provider <id>', 'Agent provider id')
    .option('--concurrency <number>', 'Maximum parallel task executions', parseInteger)
    .option('--dry-run', 'Show plan without executing tasks', false)
    .option('--mode <mode>', 'Execution mode: new-pr|update-pr|direct-commit')
    .option('--max-tasks <number>', 'Maximum number of discovered tasks to consider', parseInteger)
    .option('--timeout <seconds>', 'Per-task timeout in seconds', parseInteger)
    .action(async (options: RunCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      const outputJson = globalOptions.json;

      validateRunOptions(options);

      const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
      const repoInput = resolveRepoInput(options.repo, config);
      const providerId = resolveProviderId(options.provider, config);
      const totalBudget = resolveBudget(options.tokens, config);
      const mode = resolveMode(options.mode, config);
      const concurrency = resolveConcurrency(options.concurrency, config);
      const timeoutSeconds = resolveTimeout(options.timeout, config);
      const minPriority = config?.discovery.minPriority ?? 20;
      const maxTasks = options.maxTasks ?? undefined;
      const scannerSelection = selectScannersFromConfig(config);

      const runStartedAt = Date.now();
      const runId = randomUUID();

      if (!outputJson) {
        console.log(
          ui.blue(
            `Starting OAC run (budget: ${formatInteger(totalBudget)} tokens, concurrency: ${concurrency})`,
          ),
        );
      }

      const resolveSpinner = createSpinner(outputJson, 'Resolving repository...');
      const resolvedRepo = await resolveRepo(repoInput);
      resolveSpinner?.succeed(`Resolved ${resolvedRepo.fullName}`);

      const cloneSpinner = createSpinner(outputJson, 'Preparing local clone...');
      await cloneRepo(resolvedRepo);
      cloneSpinner?.succeed(`Repository ready at ${resolvedRepo.localPath}`);

      const scanSpinner = createSpinner(
        outputJson,
        `Running scanners: ${scannerSelection.enabled.join(', ')}`,
      );
      const scannedTasks = await scannerSelection.scanner.scan(resolvedRepo.localPath, {
        exclude: config?.discovery.exclude,
        maxTasks: config?.discovery.maxTasks,
        repo: resolvedRepo,
      });
      scanSpinner?.succeed(`Discovered ${scannedTasks.length} raw task(s)`);

      let candidateTasks = rankTasks(scannedTasks).filter((task) => task.priority >= minPriority);
      if (typeof maxTasks === 'number') {
        candidateTasks = candidateTasks.slice(0, maxTasks);
      }

      if (candidateTasks.length === 0) {
        const emptySummary: RunSummaryOutput = {
          runId,
          repo: resolvedRepo.fullName,
          provider: providerId,
          dryRun: Boolean(options.dryRun),
          selectedTasks: 0,
          deferredTasks: 0,
          tasksCompleted: 0,
          tasksFailed: 0,
          prsCreated: 0,
          tokensUsed: 0,
          tokensBudgeted: totalBudget,
        };

        if (outputJson) {
          console.log(JSON.stringify({ summary: emptySummary, plan: null }, null, 2));
        } else {
          console.log(ui.yellow('No tasks discovered for execution.'));
        }
        return;
      }

      const estimateSpinner = createSpinner(
        outputJson,
        `Estimating tokens for ${candidateTasks.length} task(s)...`,
      );
      const estimates = await estimateTaskMap(candidateTasks, providerId);
      estimateSpinner?.succeed('Token estimation completed');

      const plan = buildExecutionPlan(candidateTasks, estimates, totalBudget);

      if (options.dryRun) {
        const dryRunSummary: RunSummaryOutput = {
          runId,
          repo: resolvedRepo.fullName,
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

        if (outputJson) {
          console.log(
            JSON.stringify(
              {
                summary: dryRunSummary,
                plan,
              },
              null,
              2,
            ),
          );
        } else {
          renderSelectedPlanTable(ui, plan, totalBudget);
          console.log('');
          console.log(ui.blue('Dry run complete. No tasks were executed.'));
        }

        return;
      }

      const executionHook = readExecutionHook();
      const completionHook = readCompletionHook();

      if (!outputJson && globalOptions.verbose) {
        if (!executionHook) {
          console.log(
            ui.yellow('[oac] @oac/execution has no executeTask hook. Using fallback executor.'),
          );
        }
        if (!completionHook && mode !== 'direct-commit') {
          console.log(
            ui.yellow('[oac] @oac/completion has no completeTask hook. PR creation is skipped.'),
          );
        }
      }

      const executionSpinner = createSpinner(
        outputJson,
        `Executing ${plan.selectedTasks.length} planned task(s)...`,
      );

      let completedCount = 0;
      const executedTasks = await runWithConcurrency(
        plan.selectedTasks,
        concurrency,
        async (entry): Promise<TaskRunResult> => {
          const execution = await executeTask({
            task: entry.task,
            estimate: entry.estimate,
            providerId,
            mode,
            timeoutSeconds,
            executionHook,
          });

          completedCount += 1;
          if (executionSpinner) {
            executionSpinner.text = `Executing tasks... (${completedCount}/${plan.selectedTasks.length})`;
          }

          return {
            task: entry.task,
            estimate: entry.estimate,
            execution,
          };
        },
      );

      executionSpinner?.succeed('Execution stage finished');

      const completionSpinner = createSpinner(outputJson, 'Completing task outputs...');
      const completedTasks = await runWithConcurrency(
        executedTasks,
        concurrency,
        async (result): Promise<TaskRunResult> => {
          if (mode === 'direct-commit') {
            return result;
          }

          if (!result.execution.success) {
            return result;
          }

          const pr = await completeTask({
            completionHook,
            task: result.task,
            execution: result.execution,
            mode,
            repoFullName: resolvedRepo.fullName,
          });

          if (!pr) {
            return result;
          }

          return {
            ...result,
            pr,
          };
        },
      );
      completionSpinner?.succeed('Completion stage finished');

      const tasksCompleted = completedTasks.filter((task) => task.execution.success).length;
      const tasksFailed = completedTasks.length - tasksCompleted;
      const prsCreated = completedTasks.filter((task) => Boolean(task.pr)).length;
      const tokensUsed = completedTasks.reduce(
        (sum, task) => sum + task.execution.totalTokensUsed,
        0,
      );

      const runDurationSeconds = (Date.now() - runStartedAt) / 1000;
      const contributionLog = buildContributionLog({
        runId,
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

      const trackingSpinner = createSpinner(outputJson, 'Writing contribution log...');
      let logPath: string | undefined;
      try {
        logPath = await writeContributionLog(contributionLog, resolvedRepo.localPath);
        trackingSpinner?.succeed(`Contribution log written: ${logPath}`);
      } catch (error) {
        trackingSpinner?.fail('Failed to write contribution log');
        if (globalOptions.verbose && !outputJson) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(ui.yellow(`[oac] Tracking failed: ${message}`));
        }
      }

      const summary: RunSummaryOutput = {
        runId,
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
        logPath,
      };

      if (outputJson) {
        console.log(
          JSON.stringify(
            {
              summary,
              plan,
              tasks: completedTasks,
            },
            null,
            2,
          ),
        );
        return;
      }

      renderTaskResults(ui, completedTasks);
      console.log('');
      console.log(ui.bold('Run Summary'));
      console.log(`  Tasks completed: ${tasksCompleted}/${completedTasks.length}`);
      console.log(`  Tasks failed:    ${tasksFailed}`);
      console.log(`  PRs created:     ${prsCreated}`);
      console.log(
        `  Tokens used:     ${formatInteger(tokensUsed)} / ${formatInteger(totalBudget)}`,
      );
      console.log(`  Duration:        ${formatDuration(runDurationSeconds)}`);
      if (logPath) {
        console.log(`  Log:             ${logPath}`);
      }
    });

  return command;
}

function getGlobalOptions(command: Command): Required<GlobalCliOptions> {
  const options = command.optsWithGlobals<GlobalCliOptions>();

  return {
    config: options.config ?? 'oac.config.ts',
    verbose: options.verbose === true,
    json: options.json === true,
    color: options.color !== false,
  };
}

function createUi(options: Required<GlobalCliOptions>): Chalk {
  const noColorEnv = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR');
  const colorEnabled = options.color && !noColorEnv;

  return new Chalk({ level: colorEnabled ? chalk.level : 0 });
}

function createSpinner(enabled: boolean, text: string): Ora | null {
  if (enabled) {
    return null;
  }

  return ora({ text, color: 'blue' }).start();
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer but received "${value}".`);
  }

  return parsed;
}

function validateRunOptions(options: RunCommandOptions): void {
  if (typeof options.concurrency === 'number' && options.concurrency <= 0) {
    throw new Error('--concurrency must be greater than zero.');
  }

  if (typeof options.timeout === 'number' && options.timeout <= 0) {
    throw new Error('--timeout must be greater than zero.');
  }

  if (typeof options.maxTasks === 'number' && options.maxTasks <= 0) {
    throw new Error('--max-tasks must be greater than zero when provided.');
  }
}

async function loadOptionalConfig(
  configPath: string,
  verbose: boolean,
  ui: Chalk,
): Promise<OacConfig | null> {
  const absolutePath = resolve(process.cwd(), configPath);
  if (!(await pathExists(absolutePath))) {
    return null;
  }

  try {
    const imported = await import(`${pathToFileURL(absolutePath).href}?t=${Date.now()}`);
    const candidate = imported.default ?? imported.config ?? imported;
    return loadConfig(candidate);
  } catch (error) {
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(ui.yellow(`[oac] Failed to load config at ${configPath}: ${message}`));
    }

    return null;
  }
}

function resolveRepoInput(repoOption: string | undefined, config: OacConfig | null): string {
  const fromFlag = repoOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  const firstConfiguredRepo = config?.repos[0];
  if (typeof firstConfiguredRepo === 'string') {
    return firstConfiguredRepo;
  }

  if (
    firstConfiguredRepo &&
    typeof firstConfiguredRepo === 'object' &&
    'name' in firstConfiguredRepo &&
    typeof firstConfiguredRepo.name === 'string'
  ) {
    return firstConfiguredRepo.name;
  }

  throw new Error('No repository specified. Use --repo or configure repos in oac.config.ts.');
}

function resolveProviderId(providerOption: string | undefined, config: OacConfig | null): string {
  const fromFlag = providerOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  return config?.provider.id ?? 'claude-code';
}

function resolveBudget(tokensOption: number | undefined, config: OacConfig | null): number {
  const budget = tokensOption ?? config?.budget.totalTokens ?? 100_000;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error('Token budget must be a positive number.');
  }

  return Math.floor(budget);
}

function resolveMode(modeOption: string | undefined, config: OacConfig | null): RunMode {
  const candidate = (modeOption ?? config?.execution.mode ?? 'new-pr').trim();
  if (candidate === 'new-pr' || candidate === 'update-pr' || candidate === 'direct-commit') {
    return candidate;
  }

  throw new Error(`Invalid --mode value "${candidate}".`);
}

function resolveConcurrency(
  concurrencyOption: number | undefined,
  config: OacConfig | null,
): number {
  const configuredConcurrency =
    typeof concurrencyOption === 'number'
      ? concurrencyOption
      : (config?.execution.concurrency ?? DEFAULT_CONCURRENCY);

  if (!Number.isFinite(configuredConcurrency) || configuredConcurrency <= 0) {
    throw new Error('Concurrency must be a positive integer.');
  }

  return Math.floor(configuredConcurrency);
}

function resolveTimeout(timeoutOption: number | undefined, config: OacConfig | null): number {
  const configuredTimeout =
    typeof timeoutOption === 'number'
      ? timeoutOption
      : (config?.execution.taskTimeout ?? DEFAULT_TIMEOUT_SECONDS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    throw new Error('Timeout must be a positive integer.');
  }

  return Math.floor(configuredTimeout);
}

function selectScannersFromConfig(config: OacConfig | null): {
  enabled: SupportedScanner[];
  scanner: CompositeScanner;
} {
  const enabled: SupportedScanner[] = [];

  if (config?.discovery.scanners.lint !== false) {
    enabled.push('lint');
  }
  if (config?.discovery.scanners.todo !== false) {
    enabled.push('todo');
  }

  if (enabled.length === 0) {
    enabled.push('lint', 'todo');
  }

  const uniqueEnabled = [...new Set(enabled)];
  const scannerInstances: Scanner[] = uniqueEnabled.map((scannerName) =>
    scannerName === 'lint' ? new LintScanner() : new TodoScanner(),
  );

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

function readExecutionHook(): ExecutionHook | null {
  const candidate = (executionPackage as { executeTask?: unknown }).executeTask;
  return typeof candidate === 'function' ? (candidate as ExecutionHook) : null;
}

function readCompletionHook(): CompletionHook | null {
  const candidate = (completionPackage as { completeTask?: unknown }).completeTask;
  return typeof candidate === 'function' ? (candidate as CompletionHook) : null;
}

async function executeTask(input: {
  task: Task;
  estimate: TokenEstimate;
  providerId: string;
  mode: RunMode;
  timeoutSeconds: number;
  executionHook: ExecutionHook | null;
}): Promise<ExecutionOutcome> {
  const startedAt = Date.now();

  const executionPromise = input.executionHook
    ? Promise.resolve(
        input.executionHook({
          task: input.task,
          estimate: input.estimate,
          provider: input.providerId,
          mode: input.mode,
          timeoutSeconds: input.timeoutSeconds,
        }),
      )
    : simulateExecution(input.task, input.estimate);

  try {
    const rawResult = await withTimeout(executionPromise, input.timeoutSeconds * 1_000);
    return normalizeExecutionOutcome(rawResult, input.estimate, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      exitCode: 124,
      totalTokensUsed: 0,
      filesChanged: [],
      duration: (Date.now() - startedAt) / 1_000,
      error: message,
    };
  }
}

async function simulateExecution(
  task: Task,
  estimate: TokenEstimate,
): Promise<ExecutionOutcome> {
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

function normalizeExecutionOutcome(
  value: unknown,
  estimate: TokenEstimate,
  startedAt: number,
): ExecutionOutcome {
  if (!value || typeof value !== 'object') {
    return {
      success: true,
      exitCode: 0,
      totalTokensUsed: Math.max(1, Math.round(estimate.totalEstimatedTokens * 0.9)),
      filesChanged: [],
      duration: (Date.now() - startedAt) / 1_000,
    };
  }

  const record = value as Partial<ExecutionOutcome>;
  const success = record.success !== false;

  const filesChanged = Array.isArray(record.filesChanged)
    ? record.filesChanged.filter((file): file is string => typeof file === 'string')
    : [];

  const totalTokensUsed =
    typeof record.totalTokensUsed === 'number' && Number.isFinite(record.totalTokensUsed)
      ? Math.max(0, Math.floor(record.totalTokensUsed))
      : Math.max(1, Math.round(estimate.totalEstimatedTokens * 0.9));

  return {
    success,
    exitCode:
      typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
        ? Math.floor(record.exitCode)
        : success
          ? 0
          : 1,
    totalTokensUsed,
    filesChanged,
    duration:
      typeof record.duration === 'number' && Number.isFinite(record.duration)
        ? Math.max(0, record.duration)
        : (Date.now() - startedAt) / 1_000,
    error: typeof record.error === 'string' ? record.error : undefined,
  };
}

async function completeTask(input: {
  completionHook: CompletionHook | null;
  task: Task;
  execution: ExecutionOutcome;
  repoFullName: string;
  mode: RunMode;
}): Promise<
  | {
      number: number;
      url: string;
      status: 'open' | 'merged' | 'closed';
    }
  | undefined
> {
  if (!input.completionHook) {
    return undefined;
  }

  try {
    const result = await input.completionHook({
      task: input.task,
      execution: input.execution,
      repoFullName: input.repoFullName,
      mode: input.mode,
    });

    return normalizePr(result);
  } catch {
    return undefined;
  }
}

function normalizePr(
  value: unknown,
):
  | {
      number: number;
      url: string;
      status: 'open' | 'merged' | 'closed';
    }
  | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as { pr?: unknown };
  const candidate =
    record.pr && typeof record.pr === 'object'
      ? (record.pr as {
          number?: unknown;
          url?: unknown;
          status?: unknown;
        })
      : ((value as {
          number?: unknown;
          url?: unknown;
          status?: unknown;
        }) ?? null);

  if (!candidate) {
    return undefined;
  }

  if (
    typeof candidate.number !== 'number' ||
    !Number.isFinite(candidate.number) ||
    typeof candidate.url !== 'string'
  ) {
    return undefined;
  }

  const status =
    candidate.status === 'merged' || candidate.status === 'closed'
      ? candidate.status
      : 'open';

  return {
    number: Math.floor(candidate.number),
    url: candidate.url,
    status,
  };
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

  const tasksSucceeded = contributionTasks.filter((task) => task.status !== 'failed').length;
  const tasksFailed = contributionTasks.length - tasksSucceeded;
  const totalTokensUsed = contributionTasks.reduce((sum, task) => sum + task.tokensUsed, 0);
  const totalFilesChanged = contributionTasks.reduce(
    (sum, task) => sum + task.filesChanged.length,
    0,
  );

  return {
    version: '1.0',
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
    return 'success';
  }

  if (execution.filesChanged.length > 0) {
    return 'partial';
  }

  return 'failed';
}

function resolveGithubUsername(fallback: string): string {
  const candidates = [
    process.env.GITHUB_USER,
    process.env.GITHUB_USERNAME,
    process.env.USER,
    process.env.LOGNAME,
    fallback,
    'oac-user',
  ];

  for (const candidate of candidates) {
    const normalized = sanitizeGithubUsername(candidate ?? '');
    if (normalized) {
      return normalized;
    }
  }

  return 'oac-user';
}

function sanitizeGithubUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (cleaned.length === 0 || cleaned.length > 39) {
    return null;
  }

  if (!/^(?!-)[A-Za-z0-9-]+(?<!-)$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function renderSelectedPlanTable(
  ui: Chalk,
  plan: ReturnType<typeof buildExecutionPlan>,
  budget: number,
): void {
  const table = new Table({
    head: ['#', 'Task', 'Est. Tokens', 'Cumulative', 'Confidence'],
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
    console.log(ui.yellow('No tasks selected for execution.'));
  }

  console.log('');
  console.log(
    `Budget used: ${formatInteger(
      plan.selectedTasks[plan.selectedTasks.length - 1]?.cumulativeBudgetUsed ?? 0,
    )} / ${formatInteger(budget - plan.reserveTokens)} (effective)`,
  );
  console.log(`Reserve:     ${formatInteger(plan.reserveTokens)} (10%)`);
  console.log(`Remaining:   ${formatInteger(plan.remainingTokens)}`);

  if (plan.deferredTasks.length > 0) {
    console.log('');
    console.log(ui.yellow(`Deferred (${plan.deferredTasks.length}):`));
    for (const deferred of plan.deferredTasks) {
      console.log(
        `  - ${truncate(deferred.task.title, 72)} (${formatInteger(
          deferred.estimate.totalEstimatedTokens,
        )} tokens, ${deferred.reason.replaceAll('_', ' ')})`,
      );
    }
  }
}

function renderTaskResults(ui: Chalk, taskResults: TaskRunResult[]): void {
  for (let index = 0; index < taskResults.length; index += 1) {
    const result = taskResults[index];
    const icon = result.execution.success ? ui.green('[OK]') : ui.red('[X]');
    const status = result.execution.success ? ui.green('SUCCESS') : ui.red('FAILED');

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
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
