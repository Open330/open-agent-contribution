import { randomUUID } from "node:crypto";

import type { Epic, EpicStatus, Task, TaskComplexity, TaskSource } from "../core/types.js";
import { deriveModuleFromPath } from "./analyzer.js";
import type { CodebaseMap, ModuleInfo } from "./context-types.js";
import type { RawFinding } from "./types.js";

// ── Public options ───────────────────────────────────────────

export interface GrouperOptions {
  /** Max subtasks per epic (default: 10) */
  maxSubtasksPerEpic?: number;
  /** Min findings needed to form an epic (default: 2). Single findings become single-task epics. */
  minFindingsForEpic?: number;
  /** Codebase map for module resolution and context file population */
  codebaseMap?: CodebaseMap;
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_MAX_SUBTASKS = 10;
const DEFAULT_MIN_FINDINGS = 2;
const MAX_CONTEXT_FILES = 20;

// ── Main entry point ─────────────────────────────────────────

/**
 * Groups raw findings into Epics — coherent units of work that can be
 * executed together in a single agent session.
 */
export function groupFindingsIntoEpics(findings: RawFinding[], options?: GrouperOptions): Epic[] {
  const maxSubtasks = options?.maxSubtasksPerEpic ?? DEFAULT_MAX_SUBTASKS;
  const _minFindings = options?.minFindingsForEpic ?? DEFAULT_MIN_FINDINGS;
  const codebaseMap = options?.codebaseMap;

  // Step 1 & 2: Derive module for each finding and group by (module + source)
  const groups = new Map<string, RawFinding[]>();

  for (const finding of findings) {
    const module = finding.module ?? deriveModuleFromPath(finding.filePath);
    const key = `${module}:${finding.source}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(finding);
  }

  // Step 3 & 4: Apply size limits and handle singletons
  const epics: Epic[] = [];

  for (const [key, groupFindings] of groups) {
    const [module, source] = key.split(":") as [string, TaskSource];

    if (groupFindings.length <= maxSubtasks) {
      // Fits in a single epic (including singletons)
      epics.push(buildEpic(source, module, groupFindings, codebaseMap));
    } else {
      // Split into multiple epics
      const chunks = chunkArray(groupFindings, maxSubtasks);
      for (let i = 0; i < chunks.length; i++) {
        epics.push(
          buildEpic(source, module, chunks[i], codebaseMap, {
            partIndex: i + 1,
            totalParts: chunks.length,
          }),
        );
      }
    }
  }

  return epics;
}

// ── Epic construction ────────────────────────────────────────

interface PartInfo {
  partIndex: number;
  totalParts: number;
}

function buildEpic(
  source: TaskSource,
  module: string,
  findings: RawFinding[],
  codebaseMap?: CodebaseMap,
  partInfo?: PartInfo,
): Epic {
  const epicId = randomUUID().slice(0, 16);
  const subtasks = findings.map((f) => findingToTask(f, epicId));

  let title = buildEpicTitle(source, module, subtasks);
  if (partInfo) {
    title = `${title} (${partInfo.partIndex}/${partInfo.totalParts})`;
  }

  return {
    id: epicId,
    title,
    description: buildEpicDescription(source, module, subtasks),
    scope: module,
    subtasks,
    contextFiles: resolveContextFiles(module, codebaseMap),
    status: "pending" as EpicStatus,
    priority: computeEpicPriority(subtasks),
    estimatedTokens: 0, // filled later by estimator
    createdAt: new Date().toISOString(),
    metadata: {
      groupingStrategy: "by-module",
      source,
      findingCount: findings.length,
    },
  };
}

// ── Epic title generation ────────────────────────────────────

function buildEpicTitle(source: TaskSource, module: string, _subtasks: Task[]): string {
  const moduleLabel = module === "root" ? "" : ` for ${module} module`;

  switch (source) {
    case "test-gap":
      return `Improve test coverage${moduleLabel}`;
    case "todo":
      return `Address TODO comments${module === "root" ? "" : ` in ${module} module`}`;
    case "lint":
      return `Fix lint issues${module === "root" ? "" : ` in ${module} module`}`;
    case "dead-code":
      return `Remove dead code${module === "root" ? "" : ` in ${module} module`}`;
    case "github-issue":
      return `Resolve GitHub issues${module === "root" ? "" : ` in ${module} module`}`;
    case "custom":
      return `Address findings${module === "root" ? "" : ` in ${module} module`}`;
    default:
      return `Address ${source} findings${module === "root" ? "" : ` in ${module} module`}`;
  }
}

// ── Epic description generation ──────────────────────────────

function buildEpicDescription(source: TaskSource, module: string, subtasks: Task[]): string {
  const lines: string[] = [
    `Grouped ${subtasks.length} ${source} findings in the ${module} module:`,
    "",
  ];

  for (const task of subtasks) {
    const file = task.targetFiles.length > 0 ? `[${task.targetFiles[0]}] ` : "";
    lines.push(`- ${file}${task.title}`);
  }

  return lines.join("\n");
}

// ── Finding → Task conversion ────────────────────────────────

export function findingToTask(finding: RawFinding, epicId: string): Task {
  return {
    id: `${finding.source}-${randomUUID().slice(0, 8)}`,
    source: finding.source,
    title: finding.title,
    description: finding.description,
    targetFiles: [finding.filePath].filter(Boolean),
    priority: derivePriorityFromSeverity(finding.severity),
    complexity: finding.complexity,
    executionMode: "new-pr",
    metadata: finding.metadata,
    discoveredAt: finding.discoveredAt,
    parentEpicId: epicId,
  };
}

function derivePriorityFromSeverity(severity: "info" | "warning" | "error"): number {
  switch (severity) {
    case "error":
      return 80;
    case "warning":
      return 50;
    case "info":
      return 30;
  }
}

// ── Context files resolution ─────────────────────────────────

function resolveContextFiles(module: string, codebaseMap?: CodebaseMap): string[] {
  if (!codebaseMap) return [];

  const moduleInfo: ModuleInfo | undefined = codebaseMap.modules.find((m) => m.name === module);
  if (!moduleInfo) return [];

  return moduleInfo.files.map((f) => f.path).slice(0, MAX_CONTEXT_FILES);
}

// ── Priority & complexity computations ───────────────────────

/**
 * Weighted average of subtask priorities, with a small boost for larger epics.
 */
export function computeEpicPriority(subtasks: Task[]): number {
  if (subtasks.length === 0) return 0;

  const avg = subtasks.reduce((sum, t) => sum + t.priority, 0) / subtasks.length;
  const sizeBoost = Math.min(10, subtasks.length * 2);
  return Math.min(100, Math.round(avg + sizeBoost));
}

/**
 * Based on total subtask count and file count:
 * - 1 subtask   → subtask's own complexity
 * - 2-3 subtasks → "simple"
 * - 4-6 subtasks → "moderate"
 * - 7+ subtasks  → "complex"
 */
export function computeEpicComplexity(subtasks: Task[]): TaskComplexity {
  if (subtasks.length === 1) return subtasks[0].complexity;
  if (subtasks.length <= 3) return "simple";
  if (subtasks.length <= 6) return "moderate";
  return "complex";
}

// Re-export deriveModuleFromPath from analyzer so it is part of epic-grouper's public API
export { deriveModuleFromPath } from "./analyzer.js";

// ── Utility ──────────────────────────────────────────────────

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
