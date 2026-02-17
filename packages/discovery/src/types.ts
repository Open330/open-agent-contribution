import type { Task, TaskComplexity, TaskSource } from "@open330/oac-core";
import type { ResolvedRepo } from "@open330/oac-repo";

/**
 * Shared options passed to each scanner invocation.
 */
export interface ScanOptions {
  /**
   * Glob-like patterns to skip while scanning.
   */
  exclude?: string[];

  /**
   * Maximum runtime for a single scanner process.
   */
  timeoutMs?: number;

  /**
   * Optional hard cap on discovered tasks.
   */
  maxTasks?: number;

  /**
   * Include hidden files/directories when scanner tooling supports it.
   */
  includeHidden?: boolean;

  /**
   * Optional external abort signal.
   */
  signal?: AbortSignal;

  /**
   * Optional resolved repository metadata for scanners that need it.
   */
  repo?: ResolvedRepo;
}

/**
 * A scanner discovers actionable tasks from a local repository path.
 */
export interface Scanner {
  id: TaskSource | string;
  name: string;
  scan(repoPath: string, options?: ScanOptions): Promise<Task[]>;
}

/**
 * Priority factor values; total score should add up to 0-100.
 */
export interface PriorityWeights {
  impactScore: number; // 0-25
  feasibilityScore: number; // 0-25
  freshnessScore: number; // 0-15
  issueSignals: number; // 0-15
  tokenEfficiency: number; // 0-20
}

/**
 * Lightweight scanner-derived hints used before ranking.
 */
export interface ScannerTaskContext {
  source: TaskSource;
  complexity: TaskComplexity;
}
