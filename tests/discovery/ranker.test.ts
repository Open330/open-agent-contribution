import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskComplexity, TaskSource } from "../../src/core/index.js";
import { rankTasks } from "../../src/discovery/ranker.js";
import type { PriorityWeights } from "../../src/discovery/types.js";

const FIXED_NOW = new Date("2026-02-16T00:00:00.000Z").getTime();
const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-task",
    source: "lint",
    title: "Test task",
    description: "A test task",
    targetFiles: ["file.ts"],
    priority: 0,
    complexity: "trivial",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: new Date(FIXED_NOW).toISOString(),
    ...overrides,
  };
}

function rankSingle(overrides: Partial<Task> = {}): Task {
  const ranked = rankTasks([makeTask(overrides)]);
  expect(ranked).toHaveLength(1);
  return ranked[0]!;
}

function getBreakdown(task: Task): PriorityWeights {
  const metadata = task.metadata as Record<string, unknown>;
  return metadata.priorityBreakdown as PriorityWeights;
}

function makeLinkedIssue(labels: string[] = []): NonNullable<Task["linkedIssue"]> {
  return {
    number: 42,
    url: "https://example.com/issues/42",
    labels,
  };
}

describe("rankTasks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });

  it("returns an empty array when no tasks are provided", () => {
    expect(rankTasks([])).toEqual([]);
  });

  it("scores and returns a single task with a priority breakdown", () => {
    const ranked = rankTasks([makeTask()]);

    expect(ranked).toHaveLength(1);

    const task = ranked[0]!;
    const breakdown = getBreakdown(task);
    const total =
      breakdown.impactScore +
      breakdown.feasibilityScore +
      breakdown.freshnessScore +
      breakdown.issueSignals +
      breakdown.tokenEfficiency;

    expect(task.priority).toBe(total);
    expect(task.metadata).toMatchObject({
      priorityBreakdown: expect.any(Object),
    });
  });

  it("sorts tasks by priority descending", () => {
    const ranked = rankTasks([
      makeTask({
        id: "low",
        title: "Low priority task",
        source: "todo",
        complexity: "complex",
        executionMode: "direct-commit",
        targetFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
        metadata: { daysSinceLastChange: 365, estimatedTokens: 40_000 },
      }),
      makeTask({
        id: "high",
        title: "High priority task",
        source: "test-gap",
        complexity: "trivial",
        metadata: { daysSinceLastChange: 1, estimatedTokens: 1_000 },
      }),
    ]);

    expect(ranked.map((task) => task.id)).toEqual(["high", "low"]);
  });

  it("sorts tied priorities alphabetically by title", () => {
    const ranked = rankTasks([
      makeTask({ id: "b", title: "Zebra task" }),
      makeTask({ id: "a", title: "Alpha task" }),
    ]);

    expect(ranked.map((task) => task.title)).toEqual(["Alpha task", "Zebra task"]);
  });

  it("uses the expected base impact scores by source", () => {
    const expectedBySource: Record<TaskSource, number> = {
      lint: 22,
      todo: 10,
      "test-gap": 24,
      "dead-code": 14,
      "github-issue": 20,
      custom: 12,
    };

    for (const [source, expected] of Object.entries(expectedBySource) as Array<
      [TaskSource, number]
    >) {
      const breakdown = getBreakdown(rankSingle({ source }));
      expect(breakdown.impactScore).toBe(expected);
    }
  });

  it("applies todo-source matchCount bonuses (+4 at >=4, +2 at >=2)", () => {
    const plusFour = getBreakdown(rankSingle({ source: "todo", metadata: { matchCount: 4 } }));
    const plusTwo = getBreakdown(rankSingle({ source: "todo", metadata: { matchCount: 2 } }));

    expect(plusFour.impactScore).toBe(14);
    expect(plusTwo.impactScore).toBe(12);
  });

  it("applies lint issueCount bonus at 5 or more", () => {
    const breakdown = getBreakdown(rankSingle({ source: "lint", metadata: { issueCount: 5 } }));
    expect(breakdown.impactScore).toBe(24);
  });

  it("adds +2 impact when linkedIssue is present", () => {
    const breakdown = getBreakdown(
      rankSingle({ source: "custom", linkedIssue: makeLinkedIssue(["bug"]) }),
    );
    expect(breakdown.impactScore).toBe(14);
  });

  it("clamps impact to 25", () => {
    const breakdown = getBreakdown(
      rankSingle({
        source: "lint",
        linkedIssue: makeLinkedIssue(["bug"]),
        metadata: { issueCount: 99 },
      }),
    );

    expect(breakdown.impactScore).toBe(25);
  });

  it("uses the expected base feasibility scores by complexity", () => {
    const expectedByComplexity: Record<TaskComplexity, number> = {
      trivial: 25,
      simple: 20,
      moderate: 12,
      complex: 6,
    };

    for (const [complexity, expected] of Object.entries(expectedByComplexity) as Array<
      [TaskComplexity, number]
    >) {
      const breakdown = getBreakdown(rankSingle({ source: "custom", complexity }));
      expect(breakdown.feasibilityScore).toBe(expected);
    }
  });

  it("applies feasibility penalties for file count from task and metadata", () => {
    const mediumPenalty = getBreakdown(
      rankSingle({ source: "custom", targetFiles: ["a.ts", "b.ts", "c.ts"] }),
    );
    const heavyPenalty = getBreakdown(
      rankSingle({
        source: "custom",
        targetFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
      }),
    );
    const metadataPenalty = getBreakdown(
      rankSingle({
        source: "custom",
        complexity: "simple",
        targetFiles: ["only.ts"],
        metadata: { targetFileCount: 6 },
      }),
    );

    expect(mediumPenalty.feasibilityScore).toBe(21);
    expect(heavyPenalty.feasibilityScore).toBe(17);
    expect(metadataPenalty.feasibilityScore).toBe(12);
  });

  it("applies direct-commit feasibility penalty", () => {
    const breakdown = getBreakdown(
      rankSingle({
        source: "custom",
        complexity: "simple",
        executionMode: "direct-commit",
      }),
    );

    expect(breakdown.feasibilityScore).toBe(18);
  });

  it("clamps feasibility at a minimum of 0", () => {
    const breakdown = getBreakdown(
      rankSingle({
        source: "custom",
        complexity: "complex",
        executionMode: "direct-commit",
        targetFiles: ["a", "b", "c", "d", "e", "f"],
      }),
    );
    expect(breakdown.feasibilityScore).toBe(0);
  });

  it("maps freshness thresholds from daysSinceLastChange", () => {
    const cases: Array<[number, number]> = [
      [0, 15],
      [3, 15],
      [4, 12],
      [14, 12],
      [30, 9],
      [90, 6],
      [180, 4],
      [181, 2],
    ];

    for (const [days, expected] of cases) {
      const breakdown = getBreakdown(rankSingle({ metadata: { daysSinceLastChange: days } }));
      expect(breakdown.freshnessScore).toBe(expected);
    }
  });

  it("returns default freshness score of 7 without metadata and without valid discoveredAt", () => {
    const breakdown = getBreakdown(rankSingle({ discoveredAt: "not-a-date", metadata: {} }));
    expect(breakdown.freshnessScore).toBe(7);
  });

  it("uses discoveredAt age as freshness fallback when metadata is missing", () => {
    const discoveredAt = new Date(FIXED_NOW - 9 * DAY_IN_MS).toISOString();
    const breakdown = getBreakdown(rankSingle({ metadata: {}, discoveredAt }));

    expect(breakdown.freshnessScore).toBe(12);
  });

  it("applies linked-issue signal base, label cap, and label bonuses", () => {
    const breakdown = getBreakdown(
      rankSingle({
        linkedIssue: makeLinkedIssue([
          "GOOD-FIRST-ISSUE",
          "help-wanted",
          "bug",
          "enhancement",
          "triage",
        ]),
      }),
    );

    expect(breakdown.issueSignals).toBe(12);
  });

  it("adds issue-signal points from upvotes, reactions, and maintainer comments", () => {
    const breakdown = getBreakdown(
      rankSingle({
        metadata: {
          upvotes: 5,
          reactions: 7,
          maintainerComments: 4,
        },
      }),
    );

    expect(breakdown.issueSignals).toBe(7);
  });

  it("treats hasMaintainerComment as one maintainer comment when explicit count is missing", () => {
    const breakdown = getBreakdown(rankSingle({ metadata: { hasMaintainerComment: true } }));
    expect(breakdown.issueSignals).toBe(1);
  });

  it("clamps issue signals to 15", () => {
    const breakdown = getBreakdown(
      rankSingle({
        linkedIssue: makeLinkedIssue([
          "good-first-issue",
          "help-wanted",
          "bug",
          "enhancement",
          "triage",
        ]),
        metadata: {
          upvotes: 100,
          reactions: 100,
          maintainerComments: 100,
        },
      }),
    );
    expect(breakdown.issueSignals).toBe(15);
  });

  it("uses complexity defaults for token efficiency when estimatedTokens is absent", () => {
    const expectedByComplexity: Record<TaskComplexity, number> = {
      trivial: 18,
      simple: 14,
      moderate: 8,
      complex: 4,
    };

    for (const [complexity, expected] of Object.entries(expectedByComplexity) as Array<
      [TaskComplexity, number]
    >) {
      const breakdown = getBreakdown(rankSingle({ source: "custom", complexity }));
      expect(breakdown.tokenEfficiency).toBe(expected);
    }
  });

  it("maps token efficiency by estimatedTokens thresholds and supports nested token metadata", () => {
    const cases: Array<[number, number]> = [
      [1_500, 20],
      [5_000, 16],
      [12_000, 12],
      [25_000, 8],
      [25_001, 4],
    ];

    for (const [estimatedTokens, expected] of cases) {
      const breakdown = getBreakdown(
        rankSingle({
          source: "custom",
          complexity: "simple",
          metadata: { estimatedTokens },
        }),
      );
      expect(breakdown.tokenEfficiency).toBe(expected);
    }

    const nestedBreakdown = getBreakdown(
      rankSingle({
        source: "custom",
        complexity: "simple",
        metadata: {
          tokenEstimate: {
            totalEstimatedTokens: 3_000,
          },
        },
      }),
    );
    expect(nestedBreakdown.tokenEfficiency).toBe(16);
  });

  it("applies token-efficiency file penalty and high-impact boost", () => {
    const filePenalty = getBreakdown(
      rankSingle({
        source: "custom",
        complexity: "simple",
        targetFiles: ["a.ts", "b.ts", "c.ts", "d.ts"],
      }),
    );
    const highImpactBoost = getBreakdown(
      rankSingle({
        source: "test-gap",
        complexity: "simple",
      }),
    );

    expect(filePenalty.tokenEfficiency).toBe(12);
    expect(highImpactBoost.tokenEfficiency).toBe(15);
  });

  it("clamps token efficiency to 20", () => {
    const breakdown = getBreakdown(
      rankSingle({
        source: "test-gap",
        complexity: "trivial",
        metadata: { estimatedTokens: 1_000 },
      }),
    );
    expect(breakdown.tokenEfficiency).toBe(20);
  });

  it("keeps every score within its configured range", () => {
    const breakdown = getBreakdown(
      rankSingle({
        source: "lint",
        complexity: "complex",
        executionMode: "direct-commit",
        targetFiles: ["a", "b", "c", "d", "e", "f", "g"],
        linkedIssue: makeLinkedIssue([
          "good-first-issue",
          "help-wanted",
          "bug",
          "enhancement",
          "triage",
        ]),
        metadata: {
          issueCount: 10,
          daysSinceLastChange: -10,
          upvotes: 999,
          reactions: 999,
          maintainerComments: 999,
          estimatedTokens: 100,
        },
      }),
    );

    expect(breakdown.impactScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.impactScore).toBeLessThanOrEqual(25);
    expect(breakdown.feasibilityScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.feasibilityScore).toBeLessThanOrEqual(25);
    expect(breakdown.freshnessScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.freshnessScore).toBeLessThanOrEqual(15);
    expect(breakdown.issueSignals).toBeGreaterThanOrEqual(0);
    expect(breakdown.issueSignals).toBeLessThanOrEqual(15);
    expect(breakdown.tokenEfficiency).toBeGreaterThanOrEqual(0);
    expect(breakdown.tokenEfficiency).toBeLessThanOrEqual(20);
  });

  it("preserves existing metadata and adds priorityBreakdown", () => {
    const task = rankSingle({
      metadata: { owner: "discovery", thumbsUp: 6 },
    });

    expect(task.metadata).toMatchObject({
      owner: "discovery",
      thumbsUp: 6,
      priorityBreakdown: expect.any(Object),
    });
  });
});
