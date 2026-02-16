import { basename } from "node:path";

import type { OacConfig } from "@oac/core";
import { type SimpleGit, simpleGit } from "simple-git";

const DEFAULT_MAX_DIFF_LINES = 500;
const DEFAULT_FORBIDDEN_PATTERNS: RegExp[] = [
  /eval\s*\(/,
  /new\s+Function\s*\(/,
  /child_process/,
  /\bexecSync\s*\(/,
  /\bspawnSync\s*\(/,
];
const DEFAULT_PROTECTED_FILES = [".env*", "*.pem", "*.key"];

interface ResolvedValidationConfig {
  maxDiffLines: number;
  forbiddenPatterns: RegExp[];
  protectedFiles: string[];
}

export interface DiffValidationConfig {
  maxDiffLines?: number;
  forbiddenPatterns?: RegExp[];
  protectedFiles?: string[];
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export async function validateDiff(
  repoPath: string,
  config?: DiffValidationConfig | OacConfig,
): Promise<ValidationResult> {
  const git = simpleGit(repoPath);
  const settings = resolveValidationConfig(config);
  const warnings: string[] = [];
  const errors: string[] = [];

  const [diffSummary, changedFiles, patch] = await Promise.all([
    readDiffSummary(git),
    readChangedFiles(git),
    readPatch(git),
  ]);

  const totalLinesChanged = diffSummary.insertions + diffSummary.deletions;
  if (totalLinesChanged > settings.maxDiffLines) {
    errors.push(
      `Diff too large: ${totalLinesChanged} changed lines exceeds maxDiffLines=${settings.maxDiffLines}.`,
    );
  } else if (totalLinesChanged > Math.floor(settings.maxDiffLines * 0.8)) {
    warnings.push(
      `Diff is near the maximum size (${totalLinesChanged}/${settings.maxDiffLines} changed lines).`,
    );
  }

  if (totalLinesChanged === 0) {
    warnings.push("No changed lines detected in the current diff.");
  }

  const protectedFileHits = changedFiles.filter((path) =>
    settings.protectedFiles.some((pattern) => matchesGlob(path, pattern)),
  );
  if (protectedFileHits.length > 0) {
    errors.push(`Protected files were modified: ${protectedFileHits.join(", ")}.`);
  }

  const forbiddenHits = findForbiddenPatternHits(patch, settings.forbiddenPatterns);
  errors.push(...forbiddenHits);

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

async function readDiffSummary(git: SimpleGit) {
  try {
    return await git.diffSummary(["HEAD"]);
  } catch {
    return git.diffSummary();
  }
}

async function readChangedFiles(git: SimpleGit): Promise<string[]> {
  const withHead = await tryGitDiff(git, ["--name-only", "HEAD"]);
  const output = withHead ?? (await git.diff(["--name-only"]));

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPatch(git: SimpleGit): Promise<string> {
  const withHead = await tryGitDiff(git, ["--no-color", "--unified=0", "HEAD"]);
  if (withHead !== undefined) {
    return withHead;
  }
  return git.diff(["--no-color", "--unified=0"]);
}

async function tryGitDiff(git: SimpleGit, args: string[]): Promise<string | undefined> {
  try {
    return await git.diff(args);
  } catch {
    return undefined;
  }
}

function resolveValidationConfig(
  config?: DiffValidationConfig | OacConfig,
): ResolvedValidationConfig {
  const diffConfig = isOacConfig(config) ? undefined : config;
  const maxDiffLines = isOacConfig(config)
    ? config.execution.validation.maxDiffLines
    : diffConfig?.maxDiffLines;

  return {
    maxDiffLines:
      typeof maxDiffLines === "number" && maxDiffLines > 0
        ? Math.floor(maxDiffLines)
        : DEFAULT_MAX_DIFF_LINES,
    forbiddenPatterns:
      Array.isArray(diffConfig?.forbiddenPatterns) && diffConfig.forbiddenPatterns.length > 0
        ? diffConfig.forbiddenPatterns
        : DEFAULT_FORBIDDEN_PATTERNS,
    protectedFiles:
      Array.isArray(diffConfig?.protectedFiles) && diffConfig.protectedFiles.length > 0
        ? diffConfig.protectedFiles
        : DEFAULT_PROTECTED_FILES,
  };
}

function isOacConfig(value: DiffValidationConfig | OacConfig | undefined): value is OacConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "execution" in value &&
    typeof (value as { execution?: unknown }).execution === "object"
  );
}

function findForbiddenPatternHits(diffPatch: string, patterns: RegExp[]): string[] {
  const hits = new Set<string>();
  let currentFile = "(unknown)";

  for (const line of diffPatch.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length).trim();
      continue;
    }

    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const addedLine = line.slice(1);
    for (const pattern of patterns) {
      if (patternMatches(pattern, addedLine)) {
        const preview = truncate(addedLine.trim(), 120);
        hits.add(`Forbidden pattern "${pattern}" found in ${currentFile}: "${preview}".`);
      }
    }
  }

  return [...hits];
}

function patternMatches(pattern: RegExp, input: string): boolean {
  const normalizedFlags = pattern.flags.replaceAll("g", "");
  const matcher = new RegExp(pattern.source, normalizedFlags);
  return matcher.test(input);
}

function matchesGlob(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  const filename = basename(path);
  return regex.test(path) || regex.test(filename);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replaceAll(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
