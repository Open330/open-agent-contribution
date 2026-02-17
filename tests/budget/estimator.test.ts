import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { estimateTokens } from "../../src/budget/estimator.js";
import type { Task } from "../../src/budget/estimator.js";
import { ClaudeTokenCounter } from "../../src/budget/providers/claude-counter.js";
import { CodexTokenCounter } from "../../src/budget/providers/codex-counter.js";

const tempDirs: string[] = [];

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

async function makeTempFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "oac-budget-estimator-"));
  const filePath = join(directory, "fixture.ts");
  tempDirs.push(directory);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("estimateTokens", () => {
  it("returns token estimate for a simple task with no target files", async () => {
    const task = makeTask({
      source: "todo",
      complexity: "trivial",
      targetFiles: [],
    });

    const estimate = await estimateTokens(task, "claude-code");

    expect(estimate.taskId).toBe(task.id);
    expect(estimate.providerId).toBe("claude-code");
    expect(estimate.contextTokens).toBe(0);
    expect(estimate.promptTokens).toBeGreaterThan(0);
    expect(estimate.totalEstimatedTokens).toBeGreaterThan(0);
    expect(estimate.feasible).toBe(true);
  });

  it("returns token estimate for a task with target files that exist", async () => {
    const filePath = await makeTempFile("export const value = 42;\n".repeat(20));
    const task = makeTask({
      source: "todo",
      complexity: "trivial",
      targetFiles: [filePath],
    });

    const estimate = await estimateTokens(task, "claude-code");

    expect(estimate.contextTokens).toBeGreaterThan(0);
    expect(estimate.totalEstimatedTokens).toBeGreaterThan(estimate.promptTokens);
    expect(estimate.feasible).toBe(true);
  });

  it("returns feasible=false when estimated tokens exceed max context", async () => {
    vi.spyOn(ClaudeTokenCounter.prototype, "countTokens").mockReturnValue(100_000);
    const task = makeTask({
      source: "todo",
      complexity: "trivial",
      targetFiles: [],
    });

    const estimate = await estimateTokens(task, "claude-code");

    expect(estimate.totalEstimatedTokens).toBeGreaterThan(200_000);
    expect(estimate.feasible).toBe(false);
  });

  it('uses claude counter when provider is "claude-code"', async () => {
    const claudeSpy = vi.spyOn(ClaudeTokenCounter.prototype, "countTokens");
    const codexSpy = vi.spyOn(CodexTokenCounter.prototype, "countTokens");

    await estimateTokens(makeTask(), "claude-code");

    expect(claudeSpy).toHaveBeenCalled();
    expect(codexSpy).not.toHaveBeenCalled();
  });

  it('uses codex counter when provider is "codex-cli"', async () => {
    const claudeSpy = vi.spyOn(ClaudeTokenCounter.prototype, "countTokens");
    const codexSpy = vi.spyOn(CodexTokenCounter.prototype, "countTokens");

    await estimateTokens(makeTask(), "codex-cli");

    expect(codexSpy).toHaveBeenCalled();
    expect(claudeSpy).not.toHaveBeenCalled();
  });

  it("confidence is reduced when files are missing", async () => {
    const existingFile = await makeTempFile("const value = 1;\n");
    const missingFile = `${existingFile}.missing`;

    const withExistingFile = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "trivial",
        targetFiles: [existingFile],
      }),
      "claude-code",
    );

    const withMissingFile = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "trivial",
        targetFiles: [missingFile],
      }),
      "claude-code",
    );

    expect(withMissingFile.confidence).toBeLessThan(withExistingFile.confidence);
  });

  it("confidence is reduced when no target files", async () => {
    const existingFile = await makeTempFile("const value = 1;\n");

    const withFile = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "trivial",
        targetFiles: [existingFile],
      }),
      "claude-code",
    );

    const withoutFiles = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "trivial",
        targetFiles: [],
      }),
      "claude-code",
    );

    expect(withoutFiles.confidence).toBeLessThan(withFile.confidence);
  });

  it("confidence is reduced when declared and analyzed complexity differ", async () => {
    const fileA = await makeTempFile("export const a = 1;\n");
    const fileB = await makeTempFile("export const b = 2;\n");
    const fileC = await makeTempFile("export const c = 3;\n");

    const matchedComplexity = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "simple",
        targetFiles: [fileA, fileB, fileC],
      }),
      "claude-code",
    );

    const mismatchedComplexity = await estimateTokens(
      makeTask({
        source: "todo",
        complexity: "simple",
        targetFiles: [fileA],
      }),
      "claude-code",
    );

    expect(mismatchedComplexity.confidence).toBeLessThan(matchedComplexity.confidence);
  });
});
