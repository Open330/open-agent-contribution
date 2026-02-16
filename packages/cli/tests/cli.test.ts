import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCliProgram } from "../src/cli.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createCliProgram", () => {
  it("returns a Commander program with expected commands", async () => {
    const program = await createCliProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());

    expect(commandNames).toContain("init");
    expect(commandNames).toContain("doctor");
    expect(commandNames).toContain("scan");
    expect(commandNames).toContain("plan");
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("log");
    expect(commandNames).toContain("leaderboard");
    expect(commandNames).toContain("status");
  });

  it("has global options --config, --verbose, --json, --no-color", async () => {
    const program = await createCliProgram();
    const optionNames = program.options.map((option) => option.long);

    expect(optionNames).toContain("--config");
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--json");
    expect(optionNames).toContain("--no-color");
  });

  it("has name 'oac'", async () => {
    const program = await createCliProgram();
    expect(program.name()).toBe("oac");
  });

  it("has a version string", async () => {
    const program = await createCliProgram();
    expect(program.version()).toBeDefined();
    expect(typeof program.version()).toBe("string");
  });

  it("has 8 subcommands", async () => {
    const program = await createCliProgram();
    expect(program.commands).toHaveLength(8);
  });
});
