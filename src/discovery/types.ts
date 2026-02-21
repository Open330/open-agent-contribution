import type { Task, TaskComplexity, TaskSource } from "../core/index.js";
import type { ResolvedRepo } from "../repo/index.js";

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

  /**
   * GitHub issue labels to match (OR semantics).
   * When non-empty, only issues with at least one matching label are included.
   */
  issueLabels?: string[];
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

// ── Raw findings (pre-task, pre-grouping) ─────────────────────

/**
 * A raw finding from a scanner, before being converted to a Task or grouped
 * into an Epic.  This provides the atomic unit of information that the
 * analyzer collects and the epic-grouper aggregates.
 */
export interface RawFinding {
  scannerId: string;
  source: TaskSource;
  filePath: string;
  module?: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "error";
  complexity: TaskComplexity;
  line?: number;
  column?: number;
  metadata: Record<string, unknown>;
  discoveredAt: string;
}
