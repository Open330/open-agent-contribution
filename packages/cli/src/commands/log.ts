import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { type ContributionLog, contributionLogSchema } from "@oac/tracking";
import Table from "cli-table3";
import { Command } from "commander";

import type { GlobalCliOptions } from "../cli.js";

interface LogCommandOptions {
  limit: number;
  repo?: string;
  source?: string;
  since?: string;
}

export function createLogCommand(): Command {
  const command = new Command("log");

  command
    .description("View contribution history")
    .option("--limit <number>", "Max entries to show", parseInteger, 20)
    .option("--repo <name>", "Filter by repo name")
    .option("--source <type>", "Filter by task source")
    .option("--since <date>", "Filter contributions after date (ISO string)")
    .action(async (options: LogCommandOptions, cmd) => {
      if (options.limit <= 0) {
        throw new Error("--limit must be a positive integer.");
      }

      const globalOptions = getGlobalOptions(cmd);
      const sinceDate = parseSinceDate(options.since);
      const repoFilter = options.repo?.trim();
      const sourceFilter = options.source?.trim().toLowerCase();

      const logs = await readContributionLogs(process.cwd());
      const filteredLogs = logs
        .filter((log) => (repoFilter ? log.repo.fullName === repoFilter : true))
        .filter((log) =>
          sourceFilter ? log.tasks.some((task) => task.source === sourceFilter) : true,
        )
        .filter((log) => (sinceDate ? Date.parse(log.timestamp) >= sinceDate.getTime() : true))
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, options.limit);

      if (globalOptions.json) {
        console.log(
          JSON.stringify(
            {
              total: filteredLogs.length,
              entries: filteredLogs,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (filteredLogs.length === 0) {
        console.log("No contribution logs found.");
        return;
      }

      const table = new Table({
        head: ["Date", "Repo", "Tasks", "Tokens", "PRs", "Source"],
      });

      for (const log of filteredLogs) {
        table.push([
          formatDate(log.timestamp),
          log.repo.fullName,
          String(log.tasks.length),
          formatInteger(log.budget.totalTokensUsed),
          String(log.tasks.filter((task) => Boolean(task.pr)).length),
          summarizeSources(log),
        ]);
      }

      console.log(table.toString());
    });

  return command;
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

async function readContributionLogs(repoPath: string): Promise<ContributionLog[]> {
  const contributionsPath = resolve(repoPath, ".oac", "contributions");

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(contributionsPath, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const logs = await Promise.all(
    files.map(async (fileName): Promise<ContributionLog | null> => {
      const filePath = resolve(contributionsPath, fileName);

      try {
        const content = await readFile(filePath, "utf8");
        const payload = JSON.parse(content) as unknown;
        const parsed = contributionLogSchema.safeParse(payload);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    }),
  );

  return logs.filter((log): log is ContributionLog => log !== null);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer but received "${value}".`);
  }

  return parsed;
}

function parseSinceDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --since value "${value}". Expected an ISO date string.`);
  }

  return new Date(parsed);
}

function summarizeSources(log: ContributionLog): string {
  const uniqueSources = [...new Set(log.tasks.map((task) => task.source))].sort((a, b) =>
    a.localeCompare(b),
  );

  if (uniqueSources.length === 0) {
    return "-";
  }

  return uniqueSources.join(", ");
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toISOString();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "ENOENT";
}
