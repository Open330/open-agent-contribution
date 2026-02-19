import chalk, { Chalk, type ChalkInstance } from "chalk";
import { Command } from "commander";
import ora, { type Ora } from "ora";
import PQueue from "p-queue";

import { estimateTokens } from "../budget/index.js";
import type { OacConfig, Task, TokenEstimate } from "../core/index.js";
export type { GlobalCliOptions } from "./cli.js";
import type { GlobalCliOptions } from "./cli.js";
import { loadOptionalConfigFile } from "./config-loader.js";

// ── Global options ──────────────────────────────────────────

export function getGlobalOptions(command: Command): Required<GlobalCliOptions> {
  const options = command.optsWithGlobals<GlobalCliOptions>();

  return {
    config: options.config ?? "oac.config.ts",
    verbose: options.verbose === true,
    quiet: options.quiet === true,
    json: options.json === true,
    color: options.color !== false,
  };
}

// ── UI helpers ──────────────────────────────────────────────

export function createUi(options: Required<GlobalCliOptions>): ChalkInstance {
  const noColorEnv = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  const colorEnabled = options.color && !noColorEnv;

  return new Chalk({ level: colorEnabled ? chalk.level : 0 });
}

/**
 * Creates a spinner when output is interactive (non-JSON / non-quiet).
 * Pass `true` to suppress the spinner (e.g. in JSON output or quiet mode).
 */
export function createSpinner(suppress: boolean, text: string): Ora | null {
  if (suppress) {
    return null;
  }

  return ora({ text, color: "blue" }).start();
}

// ── Parsing helpers ─────────────────────────────────────────

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer but received "${value}".`);
  }

  return parsed;
}

// ── Formatting helpers ──────────────────────────────────────

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export { truncate } from "../core/utils.js";

// ── Config helpers ──────────────────────────────────────────

export async function loadOptionalConfig(
  configPath: string,
  verbose: boolean,
  ui: ChalkInstance,
): Promise<OacConfig | null> {
  return loadOptionalConfigFile(configPath, {
    onWarning: verbose
      ? (message) => {
          console.warn(ui.yellow(`[oac] ${message}`));
        }
      : undefined,
  });
}

export function resolveRepoInput(repoOption: string | undefined, config: OacConfig | null): string {
  const fromFlag = repoOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  const firstConfiguredRepo = config?.repos[0];
  if (typeof firstConfiguredRepo === "string") {
    return firstConfiguredRepo;
  }

  if (
    firstConfiguredRepo &&
    typeof firstConfiguredRepo === "object" &&
    "name" in firstConfiguredRepo &&
    typeof firstConfiguredRepo.name === "string"
  ) {
    return firstConfiguredRepo.name;
  }

  throw new Error(
    "No repository specified.\n\n" +
      "  Quick start:  oac run --repo owner/repo\n" +
      "  With config:  oac init   (creates oac.config.ts, then just run `oac run`)\n",
  );
}

export function resolveProviderId(
  providerOption: string | undefined,
  config: OacConfig | null,
): string {
  const fromFlag = providerOption?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  return config?.provider.id ?? "claude-code";
}

export function resolveBudget(
  tokensOption: number | undefined,
  config: OacConfig | null,
): number {
  const budget = tokensOption ?? config?.budget.totalTokens ?? 100_000;
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("Token budget must be a positive number.");
  }

  return Math.floor(budget);
}

// ── Estimation helpers ──────────────────────────────────────

export async function estimateTaskMap(
  tasks: Task[],
  providerId: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, TokenEstimate>> {
  let completed = 0;
  const total = tasks.length;
  const queue = new PQueue({ concurrency: 10 });

  const entries = await Promise.all(
    tasks.map((task) =>
      queue.add(async () => {
        const estimate = await estimateTokens(task, providerId);
        completed += 1;
        onProgress?.(completed, total);
        return [task.id, estimate] as const;
      }) as Promise<readonly [string, TokenEstimate]>,
    ),
  );

  return new Map(entries);
}

