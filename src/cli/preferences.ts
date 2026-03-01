import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { execa } from "execa";

export type PreferredRunMode = "new-pr" | "direct-commit" | "branch-only";

export interface CliPreferences {
  defaultRunMode?: PreferredRunMode;
  promptForRunMode?: boolean;
}

export interface LoadedPreferences {
  effective: CliPreferences;
  global: CliPreferences | null;
  repo: CliPreferences | null;
  paths: {
    global: string;
    repo?: string;
  };
}

export interface SaveCliPreferencesInput {
  cwd?: string;
  scope: "global" | "repo";
  preferences: CliPreferences;
}

export async function loadCliPreferences(cwd: string = process.cwd()): Promise<LoadedPreferences> {
  const globalPath = resolveGlobalPreferencesPath();
  const repoRoot = await detectGitRoot(cwd);
  const repoPath = repoRoot ? resolveRepoPreferencesPath(repoRoot) : undefined;

  const [globalPrefs, repoPrefs] = await Promise.all([
    readPreferencesFile(globalPath),
    repoPath ? readPreferencesFile(repoPath) : Promise.resolve(null),
  ]);

  return {
    effective: {
      ...globalPrefs,
      ...repoPrefs,
    },
    global: globalPrefs,
    repo: repoPrefs,
    paths: {
      global: globalPath,
      repo: repoPath,
    },
  };
}

export async function saveCliPreferences(input: SaveCliPreferencesInput): Promise<string | null> {
  const cwd = input.cwd ?? process.cwd();

  const targetPath =
    input.scope === "global"
      ? resolveGlobalPreferencesPath()
      : await resolveRepoPreferencesPathFromCwd(cwd);

  if (!targetPath) {
    return null;
  }

  const normalized = normalizePreferences(input.preferences);
  await mkdir(dirname(targetPath), { recursive: true });

  if (!normalized.defaultRunMode && !normalized.promptForRunMode) {
    if (await pathExists(targetPath)) {
      await unlink(targetPath);
    }
    return targetPath;
  }

  await writeFile(targetPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return targetPath;
}

export function resolveGlobalPreferencesPath(): string {
  return resolve(homedir(), ".config", "oac", "preferences.json");
}

export function resolveRepoPreferencesPath(repoRoot: string): string {
  return resolve(repoRoot, ".oac", "preferences.json");
}

export async function detectGitRoot(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    const root = result.stdout.trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

async function resolveRepoPreferencesPathFromCwd(cwd: string): Promise<string | null> {
  const root = await detectGitRoot(cwd);
  return root ? resolveRepoPreferencesPath(root) : null;
}

async function readPreferencesFile(filePath: string): Promise<CliPreferences | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    return normalizePreferences(parsed);
  } catch {
    return null;
  }
}

function normalizePreferences(input: unknown): CliPreferences {
  if (!isRecord(input)) {
    return {};
  }

  const mode = input.defaultRunMode;
  const prompt = input.promptForRunMode;

  return {
    defaultRunMode:
      mode === "new-pr" || mode === "direct-commit" || mode === "branch-only" ? mode : undefined,
    promptForRunMode: typeof prompt === "boolean" ? prompt : undefined,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
