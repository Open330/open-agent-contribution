import type { ChalkInstance } from "chalk";
import { Command } from "commander";

import { createUi, getGlobalOptions } from "../helpers.js";

type DoctorStatus = "pass" | "warn" | "fail";

interface DoctorCheck {
  id: string;
  name: string;
  requirement: string;
  value: string;
  status: DoctorStatus;
  message?: string;
}

interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
}

const MINIMUM_NODE_VERSION = "24.0.0";

export function createDoctorCommand(): Command {
  const command = new Command("doctor");

  command.description("Check local environment readiness").action(async (_options, cmd) => {
    const globalOptions = getGlobalOptions(cmd);
    const ui = createUi(globalOptions);

    const checks = await runDoctorChecks();
    const allPassed = checks.every((check) => check.status !== "fail");

    if (globalOptions.json) {
      console.log(
        JSON.stringify(
          {
            checks,
            allPassed,
          },
          null,
          2,
        ),
      );
    } else {
      renderDoctorOutput(ui, checks, allPassed);
    }

    if (!allPassed) {
      process.exitCode = 1;
    }
  });

  return command;
}

async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const nodeVersion = process.versions.node;
  checks.push({
    id: "node",
    name: "Node.js",
    requirement: `>= ${MINIMUM_NODE_VERSION}`,
    value: `v${nodeVersion}`,
    status: isVersionAtLeast(nodeVersion, MINIMUM_NODE_VERSION) ? "pass" : "fail",
    message: `Node.js ${MINIMUM_NODE_VERSION}+ is required.`,
  });

  const gitResult = await runCommand("git", ["--version"]);
  const gitVersion = extractVersion(gitResult.stdout) ?? "--";
  checks.push({
    id: "git",
    name: "git",
    requirement: "installed",
    value: gitVersion,
    status: gitResult.ok ? "pass" : "fail",
    message: gitResult.ok ? undefined : explainCommandFailure("git", gitResult),
  });

  const githubAuthCheck = await checkGithubAuth();
  checks.push(githubAuthCheck);

  const claudeResult = await runCommand("claude", ["--version"]);
  const claudeVersion = extractVersion(claudeResult.stdout) ?? "--";
  checks.push({
    id: "claude-cli",
    name: "Claude CLI",
    requirement: "installed",
    value: claudeVersion,
    status: claudeResult.ok ? "pass" : "fail",
    message: claudeResult.ok ? undefined : explainCommandFailure("claude", claudeResult),
  });

  const codexResult = await runCommand("codex", ["--version"]);
  const codexVersion = extractVersion(codexResult.stdout) ?? "--";
  checks.push({
    id: "codex",
    name: "Codex CLI",
    requirement: "installed",
    value: codexVersion,
    status: codexResult.ok ? "pass" : "fail",
    message: codexResult.ok ? undefined : explainCommandFailure("codex", codexResult),
  });

  return checks;
}

async function checkGithubAuth(): Promise<DoctorCheck> {
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return {
      id: "github-auth",
      name: "GitHub auth",
      requirement: "gh auth status or GITHUB_TOKEN",
      value: `env:${maskToken(envToken)}`,
      status: "pass",
    };
  }

  const authResult = await runCommand("gh", ["auth", "status"]);
  if (authResult.ok) {
    const hasRepoScope = authResult.stdout.includes("repo");
    return {
      id: "github-auth",
      name: "GitHub auth",
      requirement: "gh auth status or GITHUB_TOKEN",
      value: "gh auth status",
      status: hasRepoScope ? "pass" : "warn",
      message: hasRepoScope
        ? undefined
        : "Missing 'repo' scope — private repos won't work. Run: gh auth refresh -s repo",
    };
  }

  return {
    id: "github-auth",
    name: "GitHub auth",
    requirement: "gh auth status or GITHUB_TOKEN",
    value: "--",
    status: "fail",
    message: "No GitHub authentication detected. Set GITHUB_TOKEN or run `gh auth login`.",
  };
}

function renderDoctorOutput(ui: ChalkInstance, checks: DoctorCheck[], allPassed: boolean): void {
  console.log("Checking environment...");
  console.log("");

  for (const check of checks) {
    const iconMap = { pass: ui.green("[OK]"), warn: ui.yellow("[!]"), fail: ui.red("[X]") };
    const statusMap = { pass: ui.green("PASS"), warn: ui.yellow("WARN"), fail: ui.red("FAIL") };
    const icon = iconMap[check.status];
    const status = statusMap[check.status];

    const name = check.name.padEnd(12, " ");
    const requirement = check.requirement.padEnd(30, " ");
    const value = check.value.padEnd(14, " ");

    console.log(`  ${icon} ${name} ${requirement} ${value} ${status}`);

    if (check.status === "fail" && check.message) {
      console.log(`    ${ui.red(check.message)}`);
    }
    if (check.status === "warn" && check.message) {
      console.log(`    ${ui.yellow(check.message)}`);
    }
  }

  console.log("");
  if (allPassed) {
    console.log(ui.green("All checks passed."));
  } else {
    console.log(ui.red("Some checks failed."));
  }
}

function extractVersion(output: string): string | undefined {
  const match = output.match(/v?(\d+\.\d+\.\d+)/i);
  if (!match) {
    return undefined;
  }

  return `v${match[1]}`;
}

function explainCommandFailure(commandName: string, result: CommandResult): string {
  if (result.errorCode === "ENOENT") {
    return `${commandName} is not installed or not in PATH.`;
  }

  if (result.errorMessage) {
    return result.errorMessage;
  }

  if (result.stderr.trim().length > 0) {
    return result.stderr.trim();
  }

  return `${commandName} exited with code ${String(result.exitCode)}.`;
}

function maskToken(token: string): string {
  if (token.length <= 8) {
    return `${token.slice(0, 2)}****`;
  }

  return `${token.slice(0, 4)}****${token.slice(-2)}`;
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const current = version.split(".").map((part) => Number.parseInt(part, 10));
  const required = minimum.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(current.length, required.length);

  for (let index = 0; index < length; index += 1) {
    const currentPart = current[index] ?? 0;
    const requiredPart = required[index] ?? 0;

    if (currentPart > requiredPart) {
      return true;
    }

    if (currentPart < requiredPart) {
      return false;
    }
  }

  return true;
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const { execa } = await import("execa");
    const result = await execa(command, args, {
      reject: false,
      timeout: 30_000,
      stdin: "ignore",
    });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      errorCode: nodeError.code,
      errorMessage: nodeError.message,
    };
  }
}
