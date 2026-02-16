import type { OacConfig } from "@oac/core";
import { simpleGit } from "simple-git";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { validateDiff } from "../src/diff-validator.js";

const mockGit = vi.hoisted(() => ({
  diffSummary: vi.fn(),
  diff: vi.fn(),
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

function configureGitState(input: {
  insertions: number;
  deletions: number;
  changedFiles?: string[];
  patch?: string;
}): void {
  const changedFiles = input.changedFiles ?? [];
  const patch = input.patch ?? "";

  mockGit.diffSummary.mockResolvedValue({
    changed: changedFiles.length,
    insertions: input.insertions,
    deletions: input.deletions,
    files: [],
  });

  mockGit.diff.mockImplementation(async (args?: string[]) => {
    if (Array.isArray(args) && args.includes("--name-only")) {
      return changedFiles.join("\n");
    }

    if (Array.isArray(args) && args.includes("--no-color")) {
      return patch;
    }

    return "";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  configureGitState({
    insertions: 4,
    deletions: 2,
  });
});

describe("validateDiff", () => {
  it("returns valid=true with no warnings/errors for a small diff", async () => {
    const result = await validateDiff("/tmp/repo");

    expect(simpleGit).toHaveBeenCalledWith("/tmp/repo");
    expect(result).toEqual({
      valid: true,
      warnings: [],
      errors: [],
    });
  });

  it("returns an error when changed lines exceed maxDiffLines", async () => {
    configureGitState({
      insertions: 320,
      deletions: 240,
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Diff too large");
    expect(result.errors[0]).toContain("maxDiffLines=500");
  });

  it("returns a warning when diff is near 80% of maxDiffLines", async () => {
    configureGitState({
      insertions: 401,
      deletions: 0,
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      "Diff is near the maximum size (401/500 changed lines).",
    );
  });

  it("returns a warning when no lines were changed", async () => {
    configureGitState({
      insertions: 0,
      deletions: 0,
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      "No changed lines detected in the current diff.",
    );
  });

  it("returns an error when a protected .env file is modified", async () => {
    configureGitState({
      insertions: 2,
      deletions: 1,
      changedFiles: [".env"],
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Protected files were modified: .env.",
    );
  });

  it("returns an error when a protected *.pem file is modified", async () => {
    configureGitState({
      insertions: 3,
      deletions: 1,
      changedFiles: ["certs/production.pem"],
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Protected files were modified: certs/production.pem.",
    );
  });

  it("returns an error when added lines contain eval(", async () => {
    configureGitState({
      insertions: 1,
      deletions: 0,
      changedFiles: ["src/index.ts"],
      patch: [
        "diff --git a/src/index.ts b/src/index.ts",
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        '+const out = eval("2 + 2");',
      ].join("\n"),
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (message) =>
          message.includes("Forbidden pattern") && message.includes("eval"),
      ),
    ).toBe(true);
  });

  it("returns an error when added lines contain child_process", async () => {
    configureGitState({
      insertions: 1,
      deletions: 0,
      changedFiles: ["src/runner.ts"],
      patch: [
        "diff --git a/src/runner.ts b/src/runner.ts",
        "--- a/src/runner.ts",
        "+++ b/src/runner.ts",
        "+import cp from 'child_process';",
      ].join("\n"),
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (message) =>
          message.includes("Forbidden pattern") &&
          message.includes("child_process"),
      ),
    ).toBe(true);
  });

  it("checks forbidden patterns only on added lines, not removed lines", async () => {
    configureGitState({
      insertions: 1,
      deletions: 1,
      changedFiles: ["src/safe.ts"],
      patch: [
        "diff --git a/src/safe.ts b/src/safe.ts",
        "--- a/src/safe.ts",
        "+++ b/src/safe.ts",
        '-const removed = eval("1 + 1");',
        "+const value = safeCall();",
      ].join("\n"),
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("respects custom maxDiffLines from DiffValidationConfig", async () => {
    configureGitState({
      insertions: 7,
      deletions: 4,
    });

    const result = await validateDiff("/tmp/repo", {
      maxDiffLines: 10,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("maxDiffLines=10");
  });

  it("uses custom forbiddenPatterns and replaces the defaults", async () => {
    configureGitState({
      insertions: 1,
      deletions: 0,
      patch: [
        "diff --git a/src/code.ts b/src/code.ts",
        "--- a/src/code.ts",
        "+++ b/src/code.ts",
        '+const out = eval("3 + 3");',
      ].join("\n"),
    });

    const result = await validateDiff("/tmp/repo", {
      forbiddenPatterns: [/dangerousCall/],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("uses custom protectedFiles and replaces the defaults", async () => {
    configureGitState({
      insertions: 2,
      deletions: 0,
      changedFiles: [".env"],
    });

    const result = await validateDiff("/tmp/repo", {
      protectedFiles: ["secret/*.txt"],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reads maxDiffLines from execution.validation in an OacConfig object", async () => {
    configureGitState({
      insertions: 21,
      deletions: 0,
    });
    const config = {
      execution: {
        validation: {
          maxDiffLines: 20,
        },
      },
    } as unknown as OacConfig;

    const result = await validateDiff("/tmp/repo", config);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("maxDiffLines=20");
  });

  it("reports multiple validation errors in one result", async () => {
    configureGitState({
      insertions: 560,
      deletions: 41,
      changedFiles: [".env", "certs/server.pem"],
      patch: [
        "diff --git a/src/risky.ts b/src/risky.ts",
        "--- a/src/risky.ts",
        "+++ b/src/risky.ts",
        '+const out = eval("4 + 4");',
        "+import cp from 'child_process';",
      ].join("\n"),
    });

    const result = await validateDiff("/tmp/repo");

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((message) => message.includes("Diff too large")),
    ).toBe(true);
    expect(
      result.errors.some((message) =>
        message.includes("Protected files were modified"),
      ),
    ).toBe(true);
    expect(
      result.errors.filter((message) => message.includes("Forbidden pattern"))
        .length,
    ).toBeGreaterThanOrEqual(2);
  });
});
