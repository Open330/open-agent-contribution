import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCliPreferences, saveCliPreferences } from "../../src/cli/preferences.js";

let originalHome = "";
let originalCwd = "";
const tempDirs: string[] = [];

beforeEach(() => {
  originalHome = process.env.HOME ?? "";
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.chdir(originalCwd);

  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI preferences", () => {
  it("loads global preferences when no repo-local override exists", async () => {
    const home = await createTempDir();
    process.env.HOME = home;

    const workspace = await createTempDir();
    process.chdir(workspace);

    const globalPath = await saveCliPreferences({
      scope: "global",
      preferences: {
        defaultRunMode: "new-pr",
        promptForRunMode: false,
      },
    });

    const loaded = await loadCliPreferences(workspace);
    expect(globalPath).toContain(join(".config", "oac", "preferences.json"));
    expect(loaded.global?.defaultRunMode).toBe("new-pr");
    expect(loaded.effective.defaultRunMode).toBe("new-pr");
    expect(loaded.repo).toBeNull();
  });

  it("applies repo-local preferences over global when inside git repo", async () => {
    const home = await createTempDir();
    process.env.HOME = home;

    const repo = await createTempDir();
    await execa("git", ["init"], { cwd: repo });
    process.chdir(repo);

    await saveCliPreferences({
      scope: "global",
      preferences: {
        defaultRunMode: "direct-commit",
        promptForRunMode: false,
      },
    });

    const repoPath = await saveCliPreferences({
      scope: "repo",
      preferences: {
        defaultRunMode: "branch-only",
        promptForRunMode: false,
      },
    });

    const loaded = await loadCliPreferences(repo);
    expect(repoPath).toContain(join(".oac", "preferences.json"));
    expect(loaded.global?.defaultRunMode).toBe("direct-commit");
    expect(loaded.repo?.defaultRunMode).toBe("branch-only");
    expect(loaded.effective.defaultRunMode).toBe("branch-only");
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oac-preferences-"));
  tempDirs.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}
