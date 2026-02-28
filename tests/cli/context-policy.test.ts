import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveContextAck } from "../../src/cli/commands/run/context-policy.js";
import { ConfigError } from "../../src/cli/commands/run/types.js";
import { loadConfig } from "../../src/core/config.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveContextAck", () => {
  it("returns undefined when context mode is off", async () => {
    const repo = await makeRepo();
    const config = loadConfig({ context: { mode: "off" } });

    const ack = await resolveContextAck(repo, config, chalk, true);

    expect(ack).toBeUndefined();
  });

  it("throws in enforce mode when required files are missing", async () => {
    const repo = await makeRepo();
    const config = loadConfig({
      context: {
        mode: "enforce",
        requiredGlobs: [".context/plans/**/*.md"],
      },
    });

    await expect(resolveContextAck(repo, config, chalk, true)).rejects.toBeInstanceOf(ConfigError);
  });

  it("returns acknowledgement details when policy files exist", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, ".context", "plans"), { recursive: true });
    await writeFile(
      join(repo, ".context", "plans", "ISSUE-101.md"),
      [
        "# ISSUE-101",
        "",
        "## Scope",
        "- Allowed paths: src/discovery/**",
        "## Must",
        "- Keep tests green",
      ].join("\n"),
      "utf8",
    );

    const config = loadConfig({
      context: {
        mode: "enforce",
        requiredGlobs: [".context/plans/**/*.md"],
        maxAckItems: 2,
      },
    });

    const ack = await resolveContextAck(repo, config, chalk, true);

    expect(ack).toBeDefined();
    expect(ack?.files).toEqual([".context/plans/ISSUE-101.md"]);
    expect(ack?.summary.length).toBeGreaterThan(0);
    expect(ack?.digest).toMatch(/^[a-f0-9]{64}$/u);
  });
});

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oac-context-policy-"));
  return dir;
}
