import type { ChalkInstance } from "chalk";
import type { Task, TokenEstimate } from "../../../core/index.js";
import { UNLIMITED_BUDGET } from "../../../core/index.js";
import type { GlobalCliOptions } from "../../helpers.js";
import { formatInteger } from "../../helpers.js";

export interface RunCommandOptions {
  repo?: string;
  tokens?: number;
  provider?: string;
  concurrency?: number;
  dryRun?: boolean;
  mode?: string;
  maxTasks?: number;
  timeout?: number;
  source?: string;
  retryFailed?: boolean;
}

export interface SandboxInfo {
  branchName: string;
  sandboxPath: string;
  cleanup: () => Promise<void>;
}

export type RunMode = "new-pr" | "update-pr" | "direct-commit";
export type SupportedScanner = "lint" | "todo" | "github-issues" | "test-gap";
export type CompletionStatus = "success" | "partial" | "failed";

export interface ExecutionOutcome {
  success: boolean;
  exitCode: number;
  totalTokensUsed: number;
  filesChanged: string[];
  duration: number;
  error?: string;
}

export interface TaskRunResult {
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

export interface RunSummaryOutput {
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

export const DEFAULT_TIMEOUT_SECONDS = 300;
export const DEFAULT_CONCURRENCY = 2;
/** Timeout for git push / gh pr create operations (2 minutes). */
export const PR_CREATION_TIMEOUT_MS = 120_000;

export interface PipelineContext {
  options: RunCommandOptions;
  globalOptions: Required<GlobalCliOptions>;
  ui: ChalkInstance;
  outputJson: boolean;
  /** True when interactive output should be suppressed (--json or --quiet). */
  suppressOutput: boolean;
  runId: string;
  runStartedAt: number;
}

export function formatBudgetDisplay(budget: number): string {
  if (budget >= UNLIMITED_BUDGET) {
    return "unlimited";
  }
  return formatInteger(budget);
}

export function formatDuration(seconds: number): string {
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

