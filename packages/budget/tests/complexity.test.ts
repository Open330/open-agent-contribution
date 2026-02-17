import { describe, expect, it } from "vitest";

import { analyzeTaskComplexity, estimateLocChanges } from "../src/complexity.js";
import type { Task } from "../src/estimator.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-task-1",
    source: "todo",
    title: "Test task",
    description: "A test task",
    targetFiles: [],
    priority: 50,
    complexity: "simple",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("estimateLocChanges", () => {
  it("returns metadata estimate when estimatedLoc is in metadata", () => {
    const task = makeTask({
      metadata: { estimatedLoc: 42 },
    });

    expect(estimateLocChanges(task)).toBe(42);
  });

  it("reads from nested metadata.metrics.estimatedLoc", () => {
    const task = makeTask({
      metadata: { metrics: { estimatedLoc: 57 } },
    });

    expect(estimateLocChanges(task)).toBe(57);
  });

  it("falls back to source baseline when no metadata", () => {
    const task = makeTask({
      source: "lint",
      metadata: {},
      targetFiles: [],
    });

    expect(estimateLocChanges(task)).toBe(8);
  });

  it("uses file count adjustment when target files are many", () => {
    const task = makeTask({
      source: "lint",
      metadata: {},
      targetFiles: Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`),
    });

    expect(estimateLocChanges(task)).toBe(80);
  });

  it("handles string numeric values in metadata", () => {
    const task = makeTask({
      metadata: { estimatedLoc: "37.4" },
    });

    expect(estimateLocChanges(task)).toBe(37);
  });
});

describe("analyzeTaskComplexity", () => {
  it('returns "trivial" for simple lint tasks with 1 file', () => {
    const task = makeTask({
      source: "lint",
      targetFiles: ["src/lint-target.ts"],
      complexity: "trivial",
    });

    expect(analyzeTaskComplexity(task)).toBe("trivial");
  });

  it('returns "simple" for todo tasks with few files', () => {
    const task = makeTask({
      source: "todo",
      targetFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });

    expect(analyzeTaskComplexity(task)).toBe("simple");
  });

  it('returns "moderate" for test-gap tasks', () => {
    const task = makeTask({
      source: "test-gap",
      targetFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      complexity: "moderate",
    });

    expect(analyzeTaskComplexity(task)).toBe("moderate");
  });

  it('returns "complex" for github-issue tasks with many files and high LOC', () => {
    const task = makeTask({
      source: "github-issue",
      complexity: "complex",
      targetFiles: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
        "src/g.ts",
      ],
      metadata: { estimatedLoc: 320 },
    });

    expect(analyzeTaskComplexity(task)).toBe("complex");
  });
});
