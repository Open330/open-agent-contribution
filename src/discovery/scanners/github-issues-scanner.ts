import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { truncate } from "../../core/utils.js";
import type { Task, TaskComplexity, TaskSource } from "../../core/index.js";
import type { ScanOptions, Scanner } from "../types.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const ISSUES_PER_PAGE = 30;
const OAC_PR_PAGE_SIZE = 100;
const OAC_PR_TITLE_PREFIX = "[OAC]";
const TITLE_LIMIT = 120;
const DESCRIPTION_LIMIT = 500;

const ESTIMATED_TOKENS_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  trivial: 1_500,
  simple: 4_000,
  moderate: 9_000,
  complex: 18_000,
};

interface GitHubIssueUser {
  login?: unknown;
}

interface GitHubIssueLabel {
  name?: unknown;
}

interface GitHubIssueResponse {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  html_url?: unknown;
  labels?: unknown;
  user?: unknown;
  created_at?: unknown;
  pull_request?: unknown;
}

interface RepoCoordinates {
  owner: string;
  name: string;
}

/**
 * Scanner that maps open GitHub issues into contribution tasks.
 */
export class GitHubIssuesScanner implements Scanner {
  public readonly id: TaskSource | string = "github-issue";
  public readonly name = "GitHub Issues Scanner";

  public constructor(private readonly token?: string) {}

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    const token = this.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      return [];
    }

    const repo = await resolveRepoCoordinates(repoPath, options);
    if (!repo) {
      return [];
    }

    const [issues, claimedIssueNumbers] = await Promise.all([
      fetchOpenIssues(repo, token),
      fetchOacClaimedIssueNumbers(repo, token),
    ]);
    if (issues.length === 0) {
      return [];
    }

    const discoveredAt = new Date().toISOString();
    const tasks = issues
      .filter((issue) => issue.pull_request === undefined)
      .filter((issue) => !claimedIssueNumbers.has(asNumber(issue.number) ?? -1))
      .map((issue) => mapIssueToTask(issue, discoveredAt))
      .filter((task): task is Task => task !== undefined);

    if (typeof options.maxTasks === "number" && options.maxTasks >= 0) {
      return tasks.slice(0, options.maxTasks);
    }

    return tasks;
  }
}

async function resolveRepoCoordinates(
  repoPath: string,
  options: ScanOptions,
): Promise<RepoCoordinates | undefined> {
  if (options.repo?.owner && options.repo.name) {
    return {
      owner: options.repo.owner,
      name: options.repo.name,
    };
  }

  return parseRepoFromGitConfig(repoPath);
}

async function fetchOpenIssues(
  repo: RepoCoordinates,
  token: string,
): Promise<GitHubIssueResponse[]> {
  const url =
    `${GITHUB_API_BASE_URL}/repos/` +
    `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}` +
    `/issues?state=open&per_page=${ISSUES_PER_PAGE}&sort=updated`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload.map((item) => toIssueResponse(item));
  } catch {
    return [];
  }
}

/**
 * Returns issue numbers that already have an open OAC pull request.
 * Used to skip issues during discovery so multiple OAC instances
 * targeting the same repo don't create duplicate PRs.
 */
async function fetchOacClaimedIssueNumbers(
  repo: RepoCoordinates,
  token: string,
): Promise<Set<number>> {
  const url =
    `${GITHUB_API_BASE_URL}/repos/` +
    `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}` +
    `/pulls?state=open&per_page=${OAC_PR_PAGE_SIZE}&sort=updated&direction=desc`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return new Set();
    }

    const pulls: unknown = await response.json();
    if (!Array.isArray(pulls)) {
      return new Set();
    }

    return extractClaimedIssueNumbers(pulls);
  } catch {
    return new Set();
  }
}

function extractClaimedIssueNumbers(pulls: unknown[]): Set<number> {
  const claimed = new Set<number>();
  const issueRefPattern = /(?:Fixes|Closes|Resolves)\s+#(\d+)/gi;

  for (const pr of pulls) {
    if (!pr || typeof pr !== "object") continue;

    const record = pr as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    if (!title.startsWith(OAC_PR_TITLE_PREFIX)) continue;

    const body = typeof record.body === "string" ? record.body : "";
    for (const match of body.matchAll(issueRefPattern)) {
      const num = Number.parseInt(match[1], 10);
      if (Number.isFinite(num)) {
        claimed.add(num);
      }
    }
  }

  return claimed;
}

async function parseRepoFromGitConfig(repoPath: string): Promise<RepoCoordinates | undefined> {
  const config = await readGitConfig(repoPath);
  if (!config) {
    return undefined;
  }

  const remoteUrl = extractRemoteUrl(config);
  if (!remoteUrl) {
    return undefined;
  }

  return parseGitHubRemoteUrl(remoteUrl);
}

async function readGitConfig(repoPath: string): Promise<string | undefined> {
  try {
    return await readFile(resolve(repoPath, ".git", "config"), "utf8");
  } catch {
    // Fall through and attempt to resolve .git file pointer.
  }

  try {
    const gitFile = await readFile(resolve(repoPath, ".git"), "utf8");
    const gitDir = parseGitDirPointer(gitFile);
    if (!gitDir) {
      return undefined;
    }

    return await readFile(resolve(repoPath, gitDir, "config"), "utf8");
  } catch {
    return undefined;
  }
}

function parseGitDirPointer(content: string): string | undefined {
  const match = content.match(/^\s*gitdir:\s*(.+)\s*$/im);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].trim();
}

function extractRemoteUrl(configText: string): string | undefined {
  const lines = configText.split(/\r?\n/);
  let activeRemote: string | undefined;
  let firstRemoteUrl: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const sectionMatch = line.match(/^\[\s*remote\s+"([^"]+)"\s*\]$/i);
    if (sectionMatch?.[1]) {
      activeRemote = sectionMatch[1];
      continue;
    }

    if (!activeRemote) {
      continue;
    }

    const urlMatch = line.match(/^url\s*=\s*(.+)$/i);
    if (!urlMatch?.[1]) {
      continue;
    }

    const url = urlMatch[1].trim();
    if (activeRemote === "origin") {
      return url;
    }

    if (!firstRemoteUrl) {
      firstRemoteUrl = url;
    }
  }

  return firstRemoteUrl;
}

const GITHUB_SSH_PATTERN =
  /^git@github\.com:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/i;

function parseGitHubRemoteUrl(remoteUrl: string): RepoCoordinates | undefined {
  const normalized = remoteUrl.trim();
  if (!normalized) {
    return undefined;
  }

  const sshMatch = normalized.match(GITHUB_SSH_PATTERN);
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return {
      owner: sshMatch.groups.owner,
      name: stripGitSuffix(sshMatch.groups.repo),
    };
  }

  const normalizedUrlInput = normalized.startsWith("github.com/")
    ? `https://${normalized}`
    : normalized;

  try {
    const url = new URL(normalizedUrlInput);
    if (!isGitHubHost(url.hostname)) {
      return undefined;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return undefined;
    }

    const owner = pathParts[0];
    const name = stripGitSuffix(pathParts[1]);
    if (!owner || !name) {
      return undefined;
    }

    return { owner, name };
  } catch {
    return undefined;
  }
}

function isGitHubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "github.com" || normalized === "www.github.com";
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function mapIssueToTask(issue: GitHubIssueResponse, discoveredAt: string): Task | undefined {
  const issueNumber = asNumber(issue.number);
  const rawTitle = asString(issue.title)?.trim();
  if (issueNumber === undefined || !rawTitle) {
    return undefined;
  }

  const labels = normalizeLabels(issue.labels);
  const complexity = mapComplexityFromLabels(labels);
  const estimatedTokens = ESTIMATED_TOKENS_BY_COMPLEXITY[complexity];

  const bodyText = asString(issue.body)?.trim() || "No description provided.";
  const labelSummary = labels.length > 0 ? `Labels: ${labels.join(", ")}` : "Labels: none";

  const title = truncate(rawTitle, TITLE_LIMIT);
  const description = truncate(`${bodyText}\n\n${labelSummary}`, DESCRIPTION_LIMIT);
  const url = asString(issue.html_url) ?? "";
  const author = readAuthor(issue.user);
  const createdAt = asString(issue.created_at) ?? discoveredAt;

  return {
    id: `github-issue-${issueNumber}`,
    source: "github-issue",
    title,
    description,
    targetFiles: [],
    priority: 0,
    complexity,
    executionMode: "new-pr",
    linkedIssue: {
      number: issueNumber,
      url,
      labels,
    },
    metadata: {
      issueNumber,
      labels,
      url,
      author,
      createdAt,
      estimatedTokens,
    },
    discoveredAt,
  };
}

function mapComplexityFromLabels(labels: string[]): TaskComplexity {
  const normalized = labels.map((label) => label.toLowerCase());

  if (
    normalized.some(
      (label) => label.includes("good first issue") || label.includes("good-first-issue"),
    )
  ) {
    return "simple";
  }
  if (normalized.some((label) => label.includes("feature"))) {
    return "complex";
  }
  if (normalized.some((label) => label.includes("enhancement"))) {
    return "moderate";
  }
  if (normalized.some((label) => label.includes("bug"))) {
    return "simple";
  }
  return "moderate";
}

function normalizeLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return [];
  }

  const labels: string[] = [];
  for (const rawLabel of rawLabels) {
    if (typeof rawLabel === "string") {
      const trimmed = rawLabel.trim();
      if (trimmed.length > 0) {
        labels.push(trimmed);
      }
      continue;
    }

    if (rawLabel && typeof rawLabel === "object") {
      const name = asString((rawLabel as GitHubIssueLabel).name)?.trim();
      if (name) {
        labels.push(name);
      }
    }
  }

  return Array.from(new Set(labels));
}

function readAuthor(user: unknown): string {
  if (!user || typeof user !== "object") {
    return "unknown";
  }

  const login = asString((user as GitHubIssueUser).login);
  if (!login) {
    return "unknown";
  }

  return login;
}



function toIssueResponse(value: unknown): GitHubIssueResponse {
  if (value && typeof value === "object") {
    return value as GitHubIssueResponse;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
