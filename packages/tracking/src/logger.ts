import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildLeaderboard } from "./leaderboard.js";
import { type ContributionLog, contributionLogSchema } from "./log-schema.js";

const OAC_DIRECTORY = ".oac";
const CONTRIBUTIONS_DIRECTORY = "contributions";

export async function writeContributionLog(
  log: ContributionLog,
  repoPath: string,
): Promise<string> {
  const parsedLog = contributionLogSchema.parse(log);
  const contributionsPath = resolve(repoPath, OAC_DIRECTORY, CONTRIBUTIONS_DIRECTORY);

  await mkdir(contributionsPath, { recursive: true });

  const timestamp = formatFileTimestamp(parsedLog.timestamp);
  const username = toSafeFilenameSegment(parsedLog.contributor.githubUsername);
  const filename = `${timestamp}-${username}.json`;
  const filePath = join(contributionsPath, filename);

  const payload = `${JSON.stringify(parsedLog, null, 2)}\n`;
  await writeFileAtomically(filePath, payload);
  try {
    await buildLeaderboard(repoPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown leaderboard error";
    console.warn(`[tracking] Contribution log written, but leaderboard refresh failed: ${message}`);
  }

  return filePath;
}

function formatFileTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const sec = String(date.getUTCSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}-${hh}${min}${sec}`;
}

function toSafeFilenameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "unknown";
}

async function writeFileAtomically(destinationPath: string, content: string): Promise<void> {
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, destinationPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}
