import type { Task, TaskComplexity, TaskSource } from "../core/index.js";
import type { PriorityWeights } from "./types.js";

const IMPACT_BY_SOURCE: Partial<Record<TaskSource, number>> = {
  lint: 22,
  todo: 10,
  "test-gap": 24,
  "dead-code": 14,
  "github-issue": 20,
  custom: 12,
};

const FEASIBILITY_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  trivial: 25,
  simple: 20,
  moderate: 12,
  complex: 6,
};

const TOKEN_EFFICIENCY_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  trivial: 18,
  simple: 14,
  moderate: 8,
  complex: 4,
};

/**
 * Rank tasks by computed priority (0-100) and return descending order.
 */
export function rankTasks(tasks: Task[]): Task[] {
  const ranked = tasks.map((task) => {
    const scores = scoreTask(task);
    const priority = clamp(
      Math.round(
        scores.impactScore +
          scores.feasibilityScore +
          scores.freshnessScore +
          scores.issueSignals +
          scores.tokenEfficiency,
      ),
      0,
      100,
    );

    const metadata = toRecord(task.metadata);
    return {
      ...task,
      priority,
      metadata: {
        ...metadata,
        priorityBreakdown: scores,
      },
    };
  });

  ranked.sort((left, right) => {
    const byPriority = right.priority - left.priority;
    if (byPriority !== 0) {
      return byPriority;
    }
    return left.title.localeCompare(right.title);
  });

  return ranked;
}

function scoreTask(task: Task): PriorityWeights {
  const metadata = toRecord(task.metadata);

  const impactScore = scoreImpact(task, metadata);
  const feasibilityScore = scoreFeasibility(task, metadata);
  const freshnessScore = scoreFreshness(task, metadata);
  const issueSignals = scoreIssueSignals(task, metadata);
  const tokenEfficiency = scoreTokenEfficiency(task, metadata, impactScore);

  return {
    impactScore,
    feasibilityScore,
    freshnessScore,
    issueSignals,
    tokenEfficiency,
  };
}

function scoreImpact(task: Task, metadata: Record<string, unknown>): number {
  let score = IMPACT_BY_SOURCE[task.source] ?? 12;

  const matchCount = readNumber(metadata, "matchCount");
  if (task.source === "todo" && matchCount !== undefined) {
    if (matchCount >= 4) {
      score += 4;
    } else if (matchCount >= 2) {
      score += 2;
    }
  }

  const issueCount = readNumber(metadata, "issueCount");
  if (task.source === "lint" && issueCount !== undefined && issueCount >= 5) {
    score += 2;
  }

  if (task.linkedIssue) {
    score += 2;
  }

  return clamp(score, 0, 25);
}

function scoreFeasibility(task: Task, metadata: Record<string, unknown>): number {
  let score = FEASIBILITY_BY_COMPLEXITY[task.complexity];

  const fileCount = Math.max(task.targetFiles.length, readNumber(metadata, "targetFileCount") ?? 0);
  if (fileCount >= 6) {
    score -= 8;
  } else if (fileCount >= 3) {
    score -= 4;
  }

  if (task.executionMode === "direct-commit") {
    score -= 2;
  }

  return clamp(score, 0, 25);
}

function scoreFreshness(task: Task, metadata: Record<string, unknown>): number {
  const daysSinceChange =
    readNumber(metadata, "daysSinceLastChange") ??
    readNumber(metadata, "freshnessDays") ??
    getAgeInDays(readString(metadata, "lastModifiedAt"));

  if (daysSinceChange === undefined) {
    const discoveredAge = getAgeInDays(task.discoveredAt);
    if (discoveredAge === undefined) {
      return 7;
    }
    return clamp(15 - Math.floor(discoveredAge / 3), 4, 15);
  }

  if (daysSinceChange <= 3) {
    return 15;
  }
  if (daysSinceChange <= 14) {
    return 12;
  }
  if (daysSinceChange <= 30) {
    return 9;
  }
  if (daysSinceChange <= 90) {
    return 6;
  }
  if (daysSinceChange <= 180) {
    return 4;
  }
  return 2;
}

function scoreIssueSignals(task: Task, metadata: Record<string, unknown>): number {
  let score = 0;

  if (task.linkedIssue) {
    score += 5;
    score += Math.min(task.linkedIssue.labels.length, 4);
  }

  const labels = task.linkedIssue?.labels.map((label) => label.toLowerCase()) ?? [];
  if (labels.includes("good-first-issue")) {
    score += 2;
  }
  if (labels.includes("help-wanted")) {
    score += 1;
  }

  const upvotes = readNumber(metadata, "upvotes") ?? readNumber(metadata, "thumbsUp") ?? 0;
  const reactions = readNumber(metadata, "reactions") ?? 0;
  const maintainerComments =
    readNumber(metadata, "maintainerComments") ??
    (readBoolean(metadata, "hasMaintainerComment") ? 1 : 0);

  score += Math.min(4, Math.floor(upvotes / 2) + Math.floor(reactions / 3));
  score += Math.min(3, maintainerComments);

  return clamp(score, 0, 15);
}

function scoreTokenEfficiency(
  task: Task,
  metadata: Record<string, unknown>,
  impactScore: number,
): number {
  const estimatedTokens =
    readNumber(metadata, "estimatedTokens") ??
    readNumber(metadata, "totalEstimatedTokens") ??
    readNestedNumber(metadata, "tokenEstimate", "totalEstimatedTokens");

  let score = TOKEN_EFFICIENCY_BY_COMPLEXITY[task.complexity];

  if (estimatedTokens !== undefined) {
    if (estimatedTokens <= 1_500) {
      score = 20;
    } else if (estimatedTokens <= 5_000) {
      score = 16;
    } else if (estimatedTokens <= 12_000) {
      score = 12;
    } else if (estimatedTokens <= 25_000) {
      score = 8;
    } else {
      score = 4;
    }
  }

  if (task.targetFiles.length >= 4) {
    score -= 2;
  }

  // High-impact tasks tolerate slightly lower efficiency.
  if (impactScore >= 20) {
    score += 1;
  }

  return clamp(score, 0, 20);
}

function getAgeInDays(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return undefined;
  }
  const now = Date.now();
  const diffMs = Math.max(now - time, 0);
  return Math.floor(diffMs / (24 * 60 * 60 * 1_000));
}

function readNestedNumber(
  metadata: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): number | undefined {
  const parent = toRecord(metadata[parentKey]);
  return readNumber(parent, childKey);
}

function readNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(metadata: Record<string, unknown>, key: string): boolean {
  return metadata[key] === true;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
