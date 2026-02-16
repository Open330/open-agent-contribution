import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  contributionLogSchema,
  type ContributionLog,
  type TaskSource,
} from './log-schema.js';

const OAC_DIRECTORY = '.oac';
const CONTRIBUTIONS_DIRECTORY = 'contributions';
const LEADERBOARD_FILENAME = 'leaderboard.json';
const EMPTY_TIMESTAMP = '';

interface LeaderboardAccumulator {
  githubUsername: string;
  totalRuns: number;
  totalTasksCompleted: number;
  totalTokensDonated: number;
  totalFilesChanged: number;
  totalLinesChanged: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
  firstContribution: string;
  lastContribution: string;
  sourceCounts: Map<TaskSource, number>;
}

export interface Leaderboard {
  generatedAt: string;
  entries: LeaderboardEntry[];
  repoStats: {
    totalContributions: number;
    totalTokensUsed: number;
    totalPRsCreated: number;
    totalPRsMerged: number;
    firstContribution: string;
    lastContribution: string;
  };
}

export interface LeaderboardEntry {
  githubUsername: string;
  totalRuns: number;
  totalTasksCompleted: number;
  totalTokensDonated: number;
  totalFilesChanged: number;
  totalLinesChanged: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
  favoriteTaskSource: TaskSource;
  firstContribution: string;
  lastContribution: string;
}

export async function buildLeaderboard(repoPath: string): Promise<Leaderboard> {
  const repoRoot = resolve(repoPath);
  const oacPath = join(repoRoot, OAC_DIRECTORY);
  const contributionsPath = join(oacPath, CONTRIBUTIONS_DIRECTORY);
  const logs = await readContributionLogs(contributionsPath);

  const aggregates = new Map<string, LeaderboardAccumulator>();
  const repoStats = {
    totalContributions: logs.length,
    totalTokensUsed: 0,
    totalPRsCreated: 0,
    totalPRsMerged: 0,
    firstContribution: EMPTY_TIMESTAMP,
    lastContribution: EMPTY_TIMESTAMP,
  };

  for (const log of logs) {
    const username = log.contributor.githubUsername;
    const accumulator =
      aggregates.get(username) ??
      createAccumulator(username, log.timestamp);

    accumulator.totalRuns += 1;
    accumulator.totalTasksCompleted += log.tasks.filter(
      (task) => task.status !== 'failed',
    ).length;
    accumulator.totalTokensDonated += log.budget.totalTokensUsed;
    accumulator.totalFilesChanged += log.metrics.totalFilesChanged;
    accumulator.totalLinesChanged +=
      log.metrics.totalLinesAdded + log.metrics.totalLinesRemoved;
    accumulator.firstContribution = minIsoTimestamp(
      accumulator.firstContribution,
      log.timestamp,
    );
    accumulator.lastContribution = maxIsoTimestamp(
      accumulator.lastContribution,
      log.timestamp,
    );

    for (const task of log.tasks) {
      if (task.pr) {
        accumulator.totalPRsCreated += 1;
        if (task.pr.status === 'merged') {
          accumulator.totalPRsMerged += 1;
        }
      }

      accumulator.sourceCounts.set(
        task.source,
        (accumulator.sourceCounts.get(task.source) ?? 0) + 1,
      );
    }

    aggregates.set(username, accumulator);

    repoStats.totalTokensUsed += log.budget.totalTokensUsed;
    repoStats.firstContribution = minIsoTimestamp(
      repoStats.firstContribution,
      log.timestamp,
    );
    repoStats.lastContribution = maxIsoTimestamp(
      repoStats.lastContribution,
      log.timestamp,
    );
    repoStats.totalPRsCreated += log.tasks.filter((task) => Boolean(task.pr)).length;
    repoStats.totalPRsMerged += log.tasks.filter(
      (task) => task.pr?.status === 'merged',
    ).length;
  }

  const entries: LeaderboardEntry[] = Array.from(aggregates.values())
    .map((entry) => ({
      githubUsername: entry.githubUsername,
      totalRuns: entry.totalRuns,
      totalTasksCompleted: entry.totalTasksCompleted,
      totalTokensDonated: entry.totalTokensDonated,
      totalFilesChanged: entry.totalFilesChanged,
      totalLinesChanged: entry.totalLinesChanged,
      totalPRsCreated: entry.totalPRsCreated,
      totalPRsMerged: entry.totalPRsMerged,
      favoriteTaskSource: getFavoriteTaskSource(entry.sourceCounts),
      firstContribution: entry.firstContribution,
      lastContribution: entry.lastContribution,
    }))
    .sort((a, b) => {
      if (b.totalTasksCompleted !== a.totalTasksCompleted) {
        return b.totalTasksCompleted - a.totalTasksCompleted;
      }
      if (b.totalRuns !== a.totalRuns) {
        return b.totalRuns - a.totalRuns;
      }
      if (b.totalTokensDonated !== a.totalTokensDonated) {
        return b.totalTokensDonated - a.totalTokensDonated;
      }
      return a.githubUsername.localeCompare(b.githubUsername);
    });

  const leaderboard: Leaderboard = {
    generatedAt: new Date().toISOString(),
    entries,
    repoStats,
  };

  await mkdir(oacPath, { recursive: true });
  const leaderboardPath = join(oacPath, LEADERBOARD_FILENAME);
  const payload = `${JSON.stringify(leaderboard, null, 2)}\n`;
  await writeFileAtomically(leaderboardPath, payload);

  return leaderboard;
}

function createAccumulator(
  githubUsername: string,
  initialTimestamp: string,
): LeaderboardAccumulator {
  return {
    githubUsername,
    totalRuns: 0,
    totalTasksCompleted: 0,
    totalTokensDonated: 0,
    totalFilesChanged: 0,
    totalLinesChanged: 0,
    totalPRsCreated: 0,
    totalPRsMerged: 0,
    firstContribution: initialTimestamp,
    lastContribution: initialTimestamp,
    sourceCounts: new Map<TaskSource, number>(),
  };
}

async function readContributionLogs(
  contributionsPath: string,
): Promise<ContributionLog[]> {
  let fileNames: string[];
  try {
    const entries = await readdir(contributionsPath, { withFileTypes: true });
    fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const logs = await Promise.all(
    fileNames.map(async (fileName): Promise<ContributionLog | null> => {
      const filePath = join(contributionsPath, fileName);

      try {
        const fileContent = await readFile(filePath, 'utf8');
        const parsedJson = JSON.parse(fileContent) as unknown;
        const parsedLog = contributionLogSchema.safeParse(parsedJson);

        if (!parsedLog.success) {
          console.warn(
            `[tracking] Skipping invalid contribution log "${fileName}": ${parsedLog.error.issues[0]?.message ?? 'Schema validation failed.'}`,
          );
          return null;
        }

        return parsedLog.data;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown read error';
        console.warn(
          `[tracking] Skipping unreadable contribution log "${fileName}": ${message}`,
        );
        return null;
      }
    }),
  );

  return logs.filter((log): log is ContributionLog => log !== null);
}

function getFavoriteTaskSource(sourceCounts: Map<TaskSource, number>): TaskSource {
  if (sourceCounts.size === 0) {
    return 'custom';
  }

  let favorite: TaskSource = 'custom';
  let favoriteCount = -1;

  for (const [source, count] of sourceCounts.entries()) {
    if (count > favoriteCount) {
      favorite = source;
      favoriteCount = count;
      continue;
    }

    if (count === favoriteCount && source.localeCompare(favorite) < 0) {
      favorite = source;
    }
  }

  return favorite;
}

function minIsoTimestamp(a: string, b: string): string {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIsoTimestamp(a: string, b: string): string {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT';
}

async function writeFileAtomically(
  destinationPath: string,
  content: string,
): Promise<void> {
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, destinationPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}
