import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import PQueue from "p-queue";
import {
  type ExecutionPlan,
  type ExecutionResult,
  OacError,
  type OacEventBus,
  type Task,
  type TokenEstimate,
  executionError,
} from "../core/index.js";

import type { AgentProvider } from "./agents/agent.interface.js";
import { normalizeExecutionError, toErrorMessage } from "./normalize-error.js";
import { createSandbox } from "./sandbox.js";
import { executeTask } from "./worker.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_TOKEN_BUDGET = 50_000;

export type JobStatus = "queued" | "running" | "completed" | "failed" | "retrying" | "aborted";

export interface Job {
  id: string;
  task: Task;
  estimate: TokenEstimate;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: ExecutionResult;
  error?: OacError;
  workerId?: string;
}

export interface ExecutionEngineConfig {
  concurrency?: number;
  maxAttempts?: number;
  repoPath?: string;
  baseBranch?: string;
  branchPrefix?: string;
  taskTimeoutMs?: number;
  defaultTokenBudget?: number;
}

export interface RunResult {
  jobs: Job[];
  completed: Job[];
  failed: Job[];
  aborted: Job[];
}

interface ActiveJobState {
  job: Job;
  agent: AgentProvider;
}

function sanitizeBranchSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return sanitized || "task";
}

// ── Backoff & transient-error helpers ─────────────────────────

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_JITTER_MAX_MS = 500;

/**
 * Exponential backoff with jitter.
 * Formula: min(base * 2^attempt, max) + random(0, jitterMax)
 */
export function calculateBackoff(attempt: number): number {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  const jitter = Math.random() * BACKOFF_JITTER_MAX_MS;
  return exponential + jitter;
}

/**
 * Classify an error as transient (retriable) vs permanent.
 *
 * Transient indicators: timeout, ECONNRESET, rate-limit / 429, 503,
 * OAC-specific codes (AGENT_TIMEOUT, AGENT_OOM, AGENT_RATE_LIMITED,
 * NETWORK_ERROR, GIT_LOCK_FAILED).
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof OacError) {
    return (
      error.code === "AGENT_TIMEOUT" ||
      error.code === "AGENT_OOM" ||
      error.code === "AGENT_RATE_LIMITED" ||
      error.code === "NETWORK_ERROR" ||
      error.code === "GIT_LOCK_FAILED"
    );
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const lc = message.toLowerCase();

  if (/timeout|timed?\s*out|etimedout/i.test(lc)) return true;
  if (/econnreset/i.test(lc)) return true;
  if (/rate.?limit|too many requests|429/i.test(lc)) return true;
  if (/503|service unavailable/i.test(lc)) return true;

  return false;
}

// ── Circuit Breaker ──────────────────────────────────────────

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_HALF_OPEN_MS = 60_000;

export type CircuitState = "closed" | "open" | "half-open";

/**
 * Simple circuit breaker.
 * - Opens after `CIRCUIT_FAILURE_THRESHOLD` consecutive failures.
 * - Transitions to half-open after `CIRCUIT_HALF_OPEN_MS`.
 * - A single success in half-open state closes the circuit.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  /** Record a successful operation — resets failures and closes the circuit. */
  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /** Record a failed operation — may open the circuit. */
  public recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.state = "open";
    }
  }

  /**
   * Returns `true` when the circuit is open (i.e. calls should be rejected).
   * Automatically transitions from open → half-open after the cooldown period.
   */
  public isOpen(): boolean {
    if (this.state === "closed") return false;

    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= CIRCUIT_HALF_OPEN_MS) {
        this.state = "half-open";
        return false; // allow a probe request
      }
      return true;
    }

    // half-open — allow the probe through
    return false;
  }

  /** Force-reset to the closed state. */
  public reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.state = "closed";
  }

  /** Current state (for observability / tests). */
  public getState(): CircuitState {
    return this.state;
  }
}

export class ExecutionEngine {
  private readonly queue: PQueue;
  private readonly jobs = new Map<string, Job>();
  private readonly activeJobs = new Map<string, ActiveJobState>();
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly repoPath: string;
  private readonly baseBranch: string;
  private readonly branchPrefix: string;
  private readonly taskTimeoutMs: number;
  private readonly defaultTokenBudget: number;

  private aborted = false;
  private nextAgentIndex = 0;

  public constructor(
    private readonly agents: AgentProvider[],
    private readonly eventBus: OacEventBus,
    config: ExecutionEngineConfig = {},
  ) {
    if (agents.length === 0) {
      throw executionError(
        "AGENT_NOT_AVAILABLE",
        "ExecutionEngine requires at least one agent provider",
      );
    }

    this.concurrency = Math.max(1, config.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.repoPath = config.repoPath ?? process.cwd();
    this.baseBranch = config.baseBranch ?? "main";
    this.branchPrefix = config.branchPrefix ?? "oac";
    this.taskTimeoutMs = Math.max(1, config.taskTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.defaultTokenBudget = Math.max(1, config.defaultTokenBudget ?? DEFAULT_TOKEN_BUDGET);

    this.queue = new PQueue({
      concurrency: this.concurrency,
      autoStart: false,
    });
  }

  public enqueue(plan: ExecutionPlan): Job[] {
    const enqueuedJobs: Job[] = [];

    for (const { task, estimate } of plan.selectedTasks) {
      const job: Job = {
        id: randomUUID(),
        task,
        estimate,
        status: "queued",
        attempts: 0,
        maxAttempts: this.maxAttempts,
        createdAt: Date.now(),
      };

      this.jobs.set(job.id, job);
      enqueuedJobs.push(job);
      this.schedule(job);
    }

    return enqueuedJobs;
  }

  public async run(): Promise<RunResult> {
    this.aborted = false;
    this.queue.start();
    await this.queue.onIdle();
    return this.buildRunResult();
  }

  public async abort(): Promise<void> {
    this.aborted = true;
    this.queue.pause();
    this.queue.clear();

    const abortError = executionError("AGENT_EXECUTION_FAILED", "Execution aborted by user.");

    for (const job of this.jobs.values()) {
      if (job.status === "queued" || job.status === "retrying") {
        job.status = "aborted";
        job.completedAt = Date.now();
        job.error = abortError;
      }
    }

    await Promise.all(
      [...this.activeJobs.values()].map(async ({ job, agent }) => {
        job.status = "aborted";
        job.completedAt = Date.now();
        job.error = abortError;
        this.eventBus.emit("execution:failed", {
          jobId: job.id,
          error: abortError,
        });

        try {
          await agent.abort(job.id);
        } catch {
          // Ignore agent abort errors and continue shutdown.
        }
      }),
    );
  }

  private schedule(job: Job, delayMs = 0): void {
    void this.queue
      .add(
        async () => {
          if (delayMs > 0) {
            await delay(delayMs);
          }
          await this.runJob(job);
        },
        { priority: job.task.priority },
      )
      .catch((error: unknown) => {
        const normalized = this.normalizeError(error, job);
        job.status = "failed";
        job.completedAt = Date.now();
        job.error = normalized;
        this.eventBus.emit("execution:failed", {
          jobId: job.id,
          error: normalized,
        });
      });
  }

  private async runJob(job: Job): Promise<void> {
    if (this.aborted || job.status === "aborted") {
      return;
    }

    job.attempts += 1;
    job.status = "running";
    job.startedAt ??= Date.now();

    const agent = this.selectAgent();
    job.workerId = agent.id;
    this.activeJobs.set(job.id, { job, agent });

    this.eventBus.emit("execution:started", {
      jobId: job.id,
      task: job.task,
      agent: agent.id,
    });

    let sandboxCleanup: (() => Promise<void>) | undefined;

    try {
      const branchName = this.createBranchName(job);
      const sandbox = await createSandbox(this.repoPath, branchName, this.baseBranch);
      sandboxCleanup = sandbox.cleanup;

      const result = await executeTask(agent, job.task, sandbox, this.eventBus, {
        executionId: job.id,
        tokenBudget:
          job.estimate.totalEstimatedTokens > 0
            ? job.estimate.totalEstimatedTokens
            : this.defaultTokenBudget,
        timeoutMs: this.taskTimeoutMs,
        allowCommits: true,
      });

      job.result = result;
      job.completedAt = Date.now();

      if (result.success) {
        job.status = "completed";
        this.eventBus.emit("execution:completed", {
          jobId: job.id,
          result,
        });
        return;
      }

      const failure = executionError(
        "AGENT_EXECUTION_FAILED",
        result.error ?? `Task ${job.task.id} exited with code ${result.exitCode}.`,
        {
          context: {
            taskId: job.task.id,
            jobId: job.id,
            exitCode: result.exitCode,
            attempt: job.attempts,
          },
        },
      );
      await this.handleFailure(job, failure);
    } catch (error) {
      const normalized = this.normalizeError(error, job);
      await this.handleFailure(job, normalized);
    } finally {
      this.activeJobs.delete(job.id);

      if (sandboxCleanup) {
        try {
          await sandboxCleanup();
        } catch (cleanupError) {
          const cleanupMessage = toErrorMessage(cleanupError);
          job.error ??= executionError(
            "AGENT_EXECUTION_FAILED",
            `Sandbox cleanup failed for job ${job.id}`,
            {
              context: {
                jobId: job.id,
                cleanupError: cleanupMessage,
              },
              cause: cleanupError,
            },
          );
        }
      }
    }
  }

  private async handleFailure(job: Job, error: OacError): Promise<void> {
    job.error = error;

    if (this.aborted || job.status === "aborted") {
      job.status = "aborted";
      job.completedAt = Date.now();
      return;
    }

    if (job.attempts < job.maxAttempts && isTransientError(error)) {
      job.status = "retrying";
      const retryDelay =
        error.code === "AGENT_RATE_LIMITED"
          ? Math.min(60_000, 10_000 * 2 ** (job.attempts - 1))
          : Math.min(5_000, job.attempts * 1_000);
      this.schedule(job, retryDelay);
      return;
    }

    job.status = "failed";
    job.completedAt = Date.now();
    this.eventBus.emit("execution:failed", {
      jobId: job.id,
      error,
    });
  }

  private selectAgent(): AgentProvider {
    const agent = this.agents[this.nextAgentIndex % this.agents.length];
    this.nextAgentIndex = (this.nextAgentIndex + 1) % this.agents.length;
    return agent;
  }

  private createBranchName(job: Job): string {
    const dateSegment = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const taskSegment = sanitizeBranchSegment(job.task.id);
    return `${this.branchPrefix}/${dateSegment}/${taskSegment}-${job.id.slice(0, 8)}-a${job.attempts}`;
  }

  private normalizeError(error: unknown, job: Job): OacError {
    return normalizeExecutionError(error, {
      jobId: job.id,
      taskId: job.task.id,
      attempt: job.attempts,
    });
  }

  private buildRunResult(): RunResult {
    const jobs = [...this.jobs.values()];

    return {
      jobs,
      completed: jobs.filter((job) => job.status === "completed"),
      failed: jobs.filter((job) => job.status === "failed"),
      aborted: jobs.filter((job) => job.status === "aborted"),
    };
  }
}
