import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDoctorCommand } from "../../src/cli/commands/doctor.js";

const mockedExeca = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockedExeca(...args),
}));

interface DoctorCheck {
  id: string;
  status: "pass" | "fail";
  value: string;
}

interface DoctorPayload {
  checks: DoctorCheck[];
  allPassed: boolean;
}

interface MockCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: NodeJS.ErrnoException;
}

const originalNodeVersion = process.versions.node;
const originalGithubToken = process.env.GITHUB_TOKEN;

function setNodeVersion(version: string): void {
  Object.defineProperty(process.versions, "node", {
    configurable: true,
    enumerable: true,
    value: version,
  });
}

function mockCommandResults(results: Record<string, MockCommandResult>): void {
  mockedExeca.mockImplementation((command: string) => {
    const result = results[command];
    if (!result) {
      throw new Error(`Unexpected command call: ${command}`);
    }

    if (result.error) {
      throw result.error;
    }

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  });
}

function passingCommandResults(
  overrides: Partial<Record<string, MockCommandResult>> = {},
): Record<string, MockCommandResult> {
  return {
    git: { stdout: "git version 2.43.0\n", exitCode: 0 },
    gh: { stdout: "Logged in to github.com", exitCode: 0 },
    claude: { stdout: "Claude Code v1.0.16\n", exitCode: 0 },
    codex: { stdout: "v0.2.0\n", exitCode: 0 },
    opencode: { stdout: "v0.1.0\n", exitCode: 0 },
    ...overrides,
  };
}

async function runDoctorJsonCommand(): Promise<DoctorPayload> {
  const root = new Command()
    .option("--config <path>", "Config file path", "oac.config.ts")
    .option("--verbose", "Enable verbose logging", false)
    .option("--json", "Output machine-readable JSON", false)
    .option("--no-color", "Disable ANSI colors");

  root.addCommand(createDoctorCommand());

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await root.parseAsync(["node", "oac", "--json", "doctor"]);

  const output = logSpy.mock.calls.at(-1)?.[0];
  if (typeof output !== "string") {
    throw new Error("Doctor command did not emit JSON output.");
  }

  return JSON.parse(output) as DoctorPayload;
}

function getCheck(payload: DoctorPayload, id: string): DoctorCheck {
  const check = payload.checks.find((entry) => entry.id === id);
  expect(check).toBeDefined();
  return check as DoctorCheck;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedExeca.mockReset();
  setNodeVersion(originalNodeVersion);

  if (originalGithubToken === undefined) {
    process.env.GITHUB_TOKEN = undefined;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }

  process.exitCode = 0;
});

describe("createDoctorCommand", () => {
  it("returns a Commander Command instance", () => {
    const cmd = createDoctorCommand();
    expect(cmd.name()).toBe("doctor");
  });
});

describe("isVersionAtLeast behavior through node check status", () => {
  const cases = [
    { version: "24.0.0", expected: true },
    { version: "24.1.0", expected: true },
    { version: "23.9.9", expected: false },
    { version: "24.0.1", expected: true },
    { version: "22.0.0", expected: false },
  ] as const;

  for (const testCase of cases) {
    it(`marks node ${testCase.version} against minimum 24.0.0 as ${testCase.expected ? "pass" : "fail"}`, async () => {
      setNodeVersion(testCase.version);
      mockCommandResults(passingCommandResults());

      const payload = await runDoctorJsonCommand();
      const nodeCheck = getCheck(payload, "node");

      expect(nodeCheck.status).toBe(testCase.expected ? "pass" : "fail");
      expect(nodeCheck.value).toBe(`v${testCase.version}`);
      expect(payload.allPassed).toBe(testCase.expected);
      expect(process.exitCode).toBe(testCase.expected ? 0 : 1);
    });
  }
});

describe("extractVersion behavior through command output", () => {
  it('extracts "v24.0.0" from direct version output', async () => {
    setNodeVersion("24.1.0");
    mockCommandResults(
      passingCommandResults({
        git: { stdout: "v24.0.0", exitCode: 0 },
      }),
    );

    const payload = await runDoctorJsonCommand();
    expect(getCheck(payload, "git").value).toBe("v24.0.0");
  });

  it('extracts "v2.43.0" from "git version 2.43.0"', async () => {
    setNodeVersion("24.1.0");
    mockCommandResults(
      passingCommandResults({
        git: { stdout: "git version 2.43.0", exitCode: 0 },
      }),
    );

    const payload = await runDoctorJsonCommand();
    expect(getCheck(payload, "git").value).toBe("v2.43.0");
  });

  it('extracts "v1.0.16" from "Claude Code v1.0.16"', async () => {
    setNodeVersion("24.1.0");
    mockCommandResults(
      passingCommandResults({
        claude: { stdout: "Claude Code v1.0.16", exitCode: 0 },
      }),
    );

    const payload = await runDoctorJsonCommand();
    expect(getCheck(payload, "claude-cli").value).toBe("v1.0.16");
  });

  it('returns "--" when output has no version token', async () => {
    setNodeVersion("24.1.0");
    mockCommandResults(
      passingCommandResults({
        git: { stdout: "no version here", exitCode: 0 },
      }),
    );

    const payload = await runDoctorJsonCommand();
    expect(getCheck(payload, "git").value).toBe("--");
  });

  it('returns "--" when output is empty', async () => {
    setNodeVersion("24.1.0");
    mockCommandResults(
      passingCommandResults({
        git: { stdout: "", exitCode: 0 },
      }),
    );

    const payload = await runDoctorJsonCommand();
    expect(getCheck(payload, "git").value).toBe("--");
  });
});

describe("maskToken behavior through github-auth check", () => {
  it('masks short token "abc" as "ab****"', async () => {
    setNodeVersion("24.1.0");
    process.env.GITHUB_TOKEN = "abc";
    mockCommandResults(passingCommandResults());

    const payload = await runDoctorJsonCommand();
    const githubAuthCheck = getCheck(payload, "github-auth");

    expect(githubAuthCheck.value).toBe("env:ab****");
    expect(mockedExeca.mock.calls.map((call) => call[0])).not.toContain("gh");
  });

  it('masks long token "ghp_abcd1234xy" as "ghp_****xy"', async () => {
    setNodeVersion("24.1.0");
    process.env.GITHUB_TOKEN = "ghp_abcd1234xy";
    mockCommandResults(passingCommandResults());

    const payload = await runDoctorJsonCommand();
    const githubAuthCheck = getCheck(payload, "github-auth");

    expect(githubAuthCheck.value).toBe("env:ghp_****xy");
    expect(mockedExeca.mock.calls.map((call) => call[0])).not.toContain("gh");
  });
});
