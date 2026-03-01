import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import chalk from "chalk";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadOptionalConfig } from "../../src/cli/helpers.js";

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

describe("loadOptionalConfig layered resolution", () => {
  it("merges global, cwd, and repo-scoped config with repo override priority", async () => {
    const home = await createTempDir();
    process.env.HOME = home;

    const repo = await createTempDir();
    await execa("git", ["init"], { cwd: repo });

    await mkdir(resolve(home, ".config", "oac"), { recursive: true });
    await writeFile(
      resolve(home, ".config", "oac", "oac.config.ts"),
      `export default {
  provider: { id: "codex" },
  budget: { totalTokens: 111 },
};
`,
      "utf8",
    );

    await writeFile(
      resolve(repo, "oac.config.ts"),
      `export default {
  repos: ["owner/repo"],
  provider: { id: "claude-code" },
};
`,
      "utf8",
    );

    await mkdir(resolve(repo, ".oac"), { recursive: true });
    await writeFile(
      resolve(repo, ".oac", "oac.config.ts"),
      `export default {
  budget: { totalTokens: 222 },
  execution: { mode: "branch-only" },
};
`,
      "utf8",
    );

    process.chdir(repo);
    const config = await loadOptionalConfig("oac.config.ts", false, chalk);

    expect(config).not.toBeNull();
    expect(config?.repos).toEqual(["owner/repo"]);
    expect(config?.provider.id).toBe("claude-code");
    expect(config?.budget.totalTokens).toBe(222);
    expect(config?.execution.mode).toBe("branch-only");
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oac-helpers-config-"));
  tempDirs.push(dir);
  return dir;
}
