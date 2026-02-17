import type { Task } from "@open330/oac-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeScanner, createDefaultCompositeScanner } from "../src/scanner.js";
import { LintScanner } from "../src/scanners/lint-scanner.js";
import { TodoScanner } from "../src/scanners/todo-scanner.js";
import type { ScanOptions, Scanner } from "../src/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-id",
    source: "todo",
    title: "Task title",
    description: "Task description",
    targetFiles: ["src/file.ts"],
    priority: 50,
    complexity: "simple",
    executionMode: "new-pr",
    metadata: {},
    discoveredAt: "2026-02-16T00:00:00.000Z",
    ...overrides,
  };
}

function makeMockScanner(
  id: string,
  tasks: Task[] = [],
): Scanner & { scan: ReturnType<typeof vi.fn> } {
  return {
    id,
    name: `${id} scanner`,
    scan: vi.fn().mockResolvedValue(tasks),
  };
}

function getInnerScanners(composite: CompositeScanner): Scanner[] {
  return (composite as unknown as { scanners: Scanner[] }).scanners;
}

describe("CompositeScanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("default constructor creates LintScanner and TodoScanner", () => {
    const composite = new CompositeScanner();
    const scanners = getInnerScanners(composite);

    expect(scanners).toHaveLength(2);
    expect(scanners[0]).toBeInstanceOf(LintScanner);
    expect(scanners[1]).toBeInstanceOf(TodoScanner);
  });

  it("createDefaultCompositeScanner returns a configured CompositeScanner", () => {
    const composite = createDefaultCompositeScanner();
    const scanners = getInnerScanners(composite);

    expect(composite).toBeInstanceOf(CompositeScanner);
    expect(scanners).toHaveLength(2);
    expect(scanners[0]).toBeInstanceOf(LintScanner);
    expect(scanners[1]).toBeInstanceOf(TodoScanner);
  });

  it("custom constructor accepts an explicit scanner array", () => {
    const scannerA = makeMockScanner("scanner-a");
    const scannerB = makeMockScanner("scanner-b");
    const composite = new CompositeScanner([scannerA, scannerB]);

    expect(getInnerScanners(composite)).toEqual([scannerA, scannerB]);
  });

  it("returns an empty array when all scanners return empty task lists", async () => {
    const scannerA = makeMockScanner("scanner-a", []);
    const scannerB = makeMockScanner("scanner-b", []);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results).toEqual([]);
    expect(scannerA.scan).toHaveBeenCalledWith("/repo", {});
    expect(scannerB.scan).toHaveBeenCalledWith("/repo", {});
  });

  it("collects tasks from multiple scanners", async () => {
    const scannerA = makeMockScanner("scanner-a", [
      makeTask({ id: "a", title: "Task A", priority: 20 }),
    ]);
    const scannerB = makeMockScanner("scanner-b", [
      makeTask({ id: "b", title: "Task B", priority: 80 }),
    ]);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results).toHaveLength(2);
    expect(results.map((task) => task.id)).toEqual(["b", "a"]);
  });

  it("passes repoPath and options to every scanner", async () => {
    const scannerA = makeMockScanner("scanner-a");
    const scannerB = makeMockScanner("scanner-b");
    const composite = new CompositeScanner([scannerA, scannerB]);
    const options: ScanOptions = {
      exclude: ["dist/**"],
      timeoutMs: 1234,
      maxTasks: 5,
      includeHidden: true,
    };

    await composite.scan("/repo-path", options);

    expect(scannerA.scan).toHaveBeenCalledWith("/repo-path", options);
    expect(scannerB.scan).toHaveBeenCalledWith("/repo-path", options);
  });

  it("handles a scanner failure gracefully and keeps fulfilled results", async () => {
    const scannerA = makeMockScanner("scanner-a");
    scannerA.scan.mockRejectedValue(new Error("boom"));
    const scannerB = makeMockScanner("scanner-b", [makeTask({ id: "survivor", priority: 70 })]);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("survivor");
  });

  it("returns empty when every scanner fails", async () => {
    const scannerA = makeMockScanner("scanner-a");
    const scannerB = makeMockScanner("scanner-b");
    scannerA.scan.mockRejectedValue(new Error("scanner-a failed"));
    scannerB.scan.mockRejectedValue(new Error("scanner-b failed"));
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results).toEqual([]);
  });

  it("sorts results by priority descending", async () => {
    const scannerA = makeMockScanner("scanner-a", [
      makeTask({ id: "p10", title: "P10", priority: 10 }),
      makeTask({ id: "p30", title: "P30", priority: 30 }),
    ]);
    const scannerB = makeMockScanner("scanner-b", [
      makeTask({ id: "p20", title: "P20", priority: 20 }),
    ]);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results.map((task) => task.id)).toEqual(["p30", "p20", "p10"]);
  });

  it("breaks tied priorities by title alphabetically", async () => {
    const scannerA = makeMockScanner("scanner-a", [
      makeTask({ id: "z", title: "Zebra", priority: 50 }),
      makeTask({ id: "a", title: "Alpha", priority: 50 }),
    ]);
    const composite = new CompositeScanner([scannerA]);

    const results = await composite.scan("/repo");

    expect(results.map((task) => task.title)).toEqual(["Alpha", "Zebra"]);
  });

  it("deduplicates tasks with the same source + targetFiles + title", async () => {
    const duplicateA = makeTask({
      id: "dup-a",
      source: "todo",
      title: "Same title",
      targetFiles: ["src/a.ts"],
      priority: 40,
      metadata: { fromA: true },
    });
    const duplicateB = makeTask({
      id: "dup-b",
      source: "todo",
      title: "Same title",
      targetFiles: ["src/a.ts"],
      priority: 30,
      metadata: { fromB: true },
    });
    const scannerA = makeMockScanner("scanner-a", [duplicateA]);
    const scannerB = makeMockScanner("scanner-b", [duplicateB]);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo");

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("dup-a");
  });

  it("deduplicates even when targetFiles are in a different order", async () => {
    const first = makeTask({
      id: "first",
      source: "todo",
      title: "Order agnostic",
      targetFiles: ["src/a.ts", "src/b.ts"],
      priority: 60,
    });
    const second = makeTask({
      id: "second",
      source: "todo",
      title: "Order agnostic",
      targetFiles: ["src/b.ts", "src/a.ts"],
      priority: 30,
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [first]),
      makeMockScanner("scanner-b", [second]),
    ]);

    const results = await composite.scan("/repo");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("first");
  });

  it("does not deduplicate tasks when source differs", async () => {
    const sameContentDifferentSource = [
      makeTask({
        id: "todo-task",
        source: "todo",
        title: "Shared title",
        targetFiles: ["src/file.ts"],
      }),
      makeTask({
        id: "lint-task",
        source: "lint",
        title: "Shared title",
        targetFiles: ["src/file.ts"],
      }),
    ];
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [sameContentDifferentSource[0]!]),
      makeMockScanner("scanner-b", [sameContentDifferentSource[1]!]),
    ]);

    const results = await composite.scan("/repo");
    expect(results).toHaveLength(2);
  });

  it("keeps the higher-priority task when deduplicating", async () => {
    const lowerPriority = makeTask({
      id: "low",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 10,
    });
    const higherPriority = makeTask({
      id: "high",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 90,
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [lowerPriority]),
      makeMockScanner("scanner-b", [higherPriority]),
    ]);

    const results = await composite.scan("/repo");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("high");
  });

  it("keeps the first task when duplicate priorities are tied", async () => {
    const first = makeTask({
      id: "first",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 50,
    });
    const second = makeTask({
      id: "second",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 50,
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [first]),
      makeMockScanner("scanner-b", [second]),
    ]);

    const results = await composite.scan("/repo");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("first");
  });

  it("merges metadata from duplicates and lets the winner override shared keys", async () => {
    const lowerPriority = makeTask({
      id: "low",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 30,
      metadata: { shared: "from-low", lowOnly: true },
    });
    const higherPriority = makeTask({
      id: "high",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 80,
      metadata: { shared: "from-high", highOnly: true },
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [lowerPriority]),
      makeMockScanner("scanner-b", [higherPriority]),
    ]);

    const [merged] = await composite.scan("/repo");
    expect(merged?.metadata).toMatchObject({
      shared: "from-high",
      lowOnly: true,
      highOnly: true,
    });
  });

  it("records mergedSources and duplicateTaskIds on deduplicated metadata", async () => {
    const duplicateA = makeTask({
      id: "dup-a",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 30,
    });
    const duplicateB = makeTask({
      id: "dup-b",
      source: "todo",
      title: "Duplicate",
      targetFiles: ["src/file.ts"],
      priority: 90,
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [duplicateA]),
      makeMockScanner("scanner-b", [duplicateB]),
    ]);

    const [merged] = await composite.scan("/repo");
    const metadata = (merged?.metadata ?? {}) as Record<string, unknown>;

    const mergedSources = metadata.mergedSources as string[];
    const duplicateTaskIds = metadata.duplicateTaskIds as string[];

    expect(mergedSources).toEqual(expect.arrayContaining(["scanner-a", "scanner-b", "todo"]));
    expect(new Set(mergedSources).size).toBe(mergedSources.length);
    expect(duplicateTaskIds).toEqual(expect.arrayContaining(["dup-a", "dup-b"]));
    expect(new Set(duplicateTaskIds).size).toBe(duplicateTaskIds.length);
  });

  it("stores a short dedupeHash in metadata", async () => {
    const duplicateA = makeTask({
      id: "dup-a",
      source: "todo",
      title: "Duplicate hash",
      targetFiles: ["src/file.ts"],
      priority: 20,
    });
    const duplicateB = makeTask({
      id: "dup-b",
      source: "todo",
      title: "Duplicate hash",
      targetFiles: ["src/file.ts"],
      priority: 60,
    });
    const composite = new CompositeScanner([
      makeMockScanner("scanner-a", [duplicateA]),
      makeMockScanner("scanner-b", [duplicateB]),
    ]);

    const [merged] = await composite.scan("/repo");
    const hash = (merged?.metadata as Record<string, unknown>)?.dedupeHash;

    expect(hash).toEqual(expect.stringMatching(/^[a-f0-9]{16}$/));
  });

  it("applies maxTasks after sorting and deduplication", async () => {
    const scannerA = makeMockScanner("scanner-a", [
      makeTask({ id: "a", title: "A", priority: 40 }),
      makeTask({ id: "c", title: "C", priority: 20 }),
    ]);
    const scannerB = makeMockScanner("scanner-b", [
      makeTask({ id: "b", title: "B", priority: 30 }),
    ]);
    const composite = new CompositeScanner([scannerA, scannerB]);

    const results = await composite.scan("/repo", { maxTasks: 2 });

    expect(results.map((task) => task.id)).toEqual(["a", "b"]);
  });

  it("returns no tasks when maxTasks is 0", async () => {
    const scanner = makeMockScanner("scanner-a", [makeTask({ id: "a", priority: 99 })]);
    const composite = new CompositeScanner([scanner]);

    const results = await composite.scan("/repo", { maxTasks: 0 });
    expect(results).toEqual([]);
  });

  it("ignores maxTasks when it is negative", async () => {
    const scanner = makeMockScanner("scanner-a", [
      makeTask({ id: "a", title: "A", priority: 10 }),
      makeTask({ id: "b", title: "B", priority: 20 }),
    ]);
    const composite = new CompositeScanner([scanner]);

    const results = await composite.scan("/repo", { maxTasks: -1 });
    expect(results).toHaveLength(2);
  });
});
