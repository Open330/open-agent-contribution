import { spawn } from "node:child_process";

import chalk, { Chalk, type ChalkInstance } from "chalk";
import { Command } from "commander";

import type { GlobalCliOptions } from "../cli.js";

type DoctorStatus = "pass" | "fail";

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
    const allPassed = checks.every((check) => check.status === "pass");

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
    id: "codex-cli",
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
    return {
      id: "github-auth",
      name: "GitHub auth",
      requirement: "gh auth status or GITHUB_TOKEN",
      value: "gh auth status",
      status: "pass",
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

function getGlobalOptions(command: Command): Required<GlobalCliOptions> {
  const options = command.optsWithGlobals<GlobalCliOptions>();

  return {
    config: options.config ?? "oac.config.ts",
    verbose: options.verbose === true,
    json: options.json === true,
    color: options.color !== false,
  };
}

function createUi(options: Required<GlobalCliOptions>): ChalkInstance {
  const noColorEnv = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  const colorEnabled = options.color && !noColorEnv;

  return new Chalk({ level: colorEnabled ? chalk.level : 0 });
}

function renderDoctorOutput(ui: ChalkInstance, checks: DoctorCheck[], allPassed: boolean): void {
  console.log("Checking environment...");
  console.log("");

  for (const check of checks) {
    const icon = check.status === "pass" ? ui.green("[OK]") : ui.red("[X]");
    const status = check.status === "pass" ? ui.green("PASS") : ui.red("FAIL");

    const name = check.name.padEnd(12, " ");
    const requirement = check.requirement.padEnd(30, " ");
    const value = check.value.padEnd(14, " ");

    console.log(`  ${icon} ${name} ${requirement} ${value} ${status}`);

    if (check.status === "fail" && check.message) {
      console.log(`    ${ui.red(check.message)}`);
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

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      if (resolved) {
        return;
      }

      resolved = true;
      const errorWithCode = error as NodeJS.ErrnoException;
      resolvePromise({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        errorCode: errorWithCode.code,
        errorMessage: error.message,
      });
    });

    child.once("close", (exitCode) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolvePromise({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}
