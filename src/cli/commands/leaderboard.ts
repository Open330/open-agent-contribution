import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import Table from "cli-table3";
import { Command } from "commander";
import { isRecord } from "../../core/utils.js";
import { type ContributionLog, contributionLogSchema } from "../../tracking/index.js";

import { formatInteger, getGlobalOptions, parseInteger } from "../helpers.js";

interface LeaderboardCommandOptions {
  limit: number;
  sort: string;
}

interface LeaderboardEntry {
  githubUsername: string;
  totalRuns: number;
  totalTasksCompleted: number;
  totalTokensDonated: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
}

type SortField = "runs" | "tasks" | "tokens" | "prs";

export function createLeaderboardCommand(): Command {
  const command = new Command("leaderboard");

  command
    .description("Show contribution rankings")
    .option("--limit <number>", "Max entries to show", parseInteger, 10)
    .option("--sort <field>", "Sort by: runs, tasks, tokens, prs", "tasks")
    .action(async (options: LeaderboardCommandOptions, cmd) => {
      if (options.limit <= 0) {
        throw new Error("--limit must be a positive integer.");
      }

      const globalOptions = getGlobalOptions(cmd);
      const sortField = normalizeSortField(options.sort);
      const entries = await loadLeaderboardEntries(process.cwd());
      const sortedEntries = sortEntries(entries, sortField).slice(0, options.limit);

      if (globalOptions.json) {
        console.log(
          JSON.stringify(
            {
              total: sortedEntries.length,
              sort: sortField,
              entries: sortedEntries,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (sortedEntries.length === 0) {
        console.log("No leaderboard data found.");
        return;
      }

      const table = new Table({
        head: ["Rank", "User", "Tasks", "Tokens Used", "PRs Created", "PRs Merged"],
      });

      for (let index = 0; index < sortedEntries.length; index += 1) {
        const entry = sortedEntries[index];
        table.push([
          String(index + 1),
          entry.githubUsername,
          String(entry.totalTasksCompleted),
          formatInteger(entry.totalTokensDonated),
          String(entry.totalPRsCreated),
          String(entry.totalPRsMerged),
        ]);
      }

      console.log(table.toString());
    });

  command.addHelpText(
    "after",
    `\nExamples:
  $ oac leaderboard
  $ oac leaderboard --limit 20 --sort tokens`,
  );

  return command;
}

async function loadLeaderboardEntries(repoPath: string): Promise<LeaderboardEntry[]> {
  const leaderboardPath = resolve(repoPath, ".oac", "leaderboard.json");

  try {
    const leaderboardRaw = await readFile(leaderboardPath, "utf8");
    const leaderboardPayload = JSON.parse(leaderboardRaw) as unknown;
    return parseStoredLeaderboardEntries(leaderboardPayload);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  const logs = await readContributionLogs(repoPath);
  return buildEntriesFromLogs(logs);
}

function parseStoredLeaderboardEntries(payload: unknown): LeaderboardEntry[] {
  if (!isRecord(payload)) {
    return [];
  }

  const entries = payload.entries;
  if (!Array.isArray(entries)) {
    return [];
  }

  const parsedEntries: LeaderboardEntry[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const githubUsername = entry.githubUsername;
    const totalRuns = entry.totalRuns;
    const totalTasksCompleted = entry.totalTasksCompleted;
    const totalTokensDonated = entry.totalTokensDonated;
    const totalPRsCreated = entry.totalPRsCreated;
    const totalPRsMerged = entry.totalPRsMerged;

    if (
      typeof githubUsername !== "string" ||
      typeof totalRuns !== "number" ||
      typeof totalTasksCompleted !== "number" ||
      typeof totalTokensDonated !== "number" ||
      typeof totalPRsCreated !== "number" ||
      typeof totalPRsMerged !== "number"
    ) {
      continue;
    }

    parsedEntries.push({
      githubUsername,
      totalRuns,
      totalTasksCompleted,
      totalTokensDonated,
      totalPRsCreated,
      totalPRsMerged,
    });
  }

  return parsedEntries;
}

async function readContributionLogs(repoPath: string): Promise<ContributionLog[]> {
  const contributionsPath = resolve(repoPath, ".oac", "contributions");

  let entries: Dirent[];
  try {
    entries = await readdir(contributionsPath, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const logs = await Promise.all(
    fileNames.map(async (fileName): Promise<ContributionLog | null> => {
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

function buildEntriesFromLogs(logs: ContributionLog[]): LeaderboardEntry[] {
  const byUser = new Map<string, LeaderboardEntry>();

  for (const log of logs) {
    const username = log.contributor.githubUsername;
    const existing = byUser.get(username) ?? {
      githubUsername: username,
      totalRuns: 0,
      totalTasksCompleted: 0,
      totalTokensDonated: 0,
      totalPRsCreated: 0,
      totalPRsMerged: 0,
    };

    existing.totalRuns += 1;
    existing.totalTasksCompleted += log.tasks.filter((task) => task.status !== "failed").length;
    existing.totalTokensDonated += log.budget.totalTokensUsed;
    existing.totalPRsCreated += log.tasks.filter((task) => Boolean(task.pr)).length;
    existing.totalPRsMerged += log.tasks.filter((task) => task.pr?.status === "merged").length;

    byUser.set(username, existing);
  }

  return Array.from(byUser.values());
}

function sortEntries(entries: LeaderboardEntry[], field: SortField): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    const first = sortValue(b, field) - sortValue(a, field);
    if (first !== 0) {
      return first;
    }

    if (b.totalTasksCompleted !== a.totalTasksCompleted) {
      return b.totalTasksCompleted - a.totalTasksCompleted;
    }

    if (b.totalRuns !== a.totalRuns) {
      return b.totalRuns - a.totalRuns;
    }

    return a.githubUsername.localeCompare(b.githubUsername);
  });
}

function normalizeSortField(value: string): SortField {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "runs" ||
    normalized === "tasks" ||
    normalized === "tokens" ||
    normalized === "prs"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported --sort value "${value}". Use runs, tasks, tokens, or prs.`);
}

function sortValue(entry: LeaderboardEntry, field: SortField): number {
  if (field === "runs") {
    return entry.totalRuns;
  }
  if (field === "tasks") {
    return entry.totalTasksCompleted;
  }
  if (field === "tokens") {
    return entry.totalTokensDonated;
  }
  return entry.totalPRsCreated;
}

function isFileNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === "ENOENT";
}
