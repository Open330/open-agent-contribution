import { homedir } from "node:os";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import { MetadataCache } from "./metadata-cache.js";
import type { RepoPermissions, ResolvedRepo } from "./types.js";

const OWNER_REPO_PATTERN = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/;
const GITHUB_SSH_PATTERN =
  /^git@github\.com:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/;

export type RepoResolutionErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ARCHIVED"
  | "UNKNOWN";

export class RepoResolutionError extends Error {
  public readonly code: RepoResolutionErrorCode;

  public constructor(message: string, code: RepoResolutionErrorCode, cause?: unknown) {
    super(message, { cause });
    this.name = "RepoResolutionError";
    this.code = code;
  }
}

interface ParsedRepoInput {
  owner: string;
  name: string;
}

export async function resolveRepo(input: string): Promise<ResolvedRepo> {
  const parsed = parseRepoInput(input);
  const cache = new MetadataCache();
  const cacheKey = `${parsed.owner}/${parsed.name}`;
  const cached = await cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const repoData = await fetchRepo(octokit, parsed.owner, parsed.name);
  if (repoData.archived) {
    throw new RepoResolutionError(
      `Repository "${repoData.full_name}" is archived and cannot be used for contributions.`,
      "ARCHIVED",
    );
  }

  const permissions = normalizePermissions(repoData.private, repoData.permissions);
  if (!permissions.pull) {
    throw new RepoResolutionError(
      `Missing pull permission for "${repoData.full_name}".`,
      "FORBIDDEN",
    );
  }

  const [languages, headSha] = await Promise.all([
    fetchLanguages(octokit, repoData.owner.login, repoData.name),
    fetchHeadSha(octokit, repoData.owner.login, repoData.name, repoData.default_branch),
  ]);

  const localPath = defaultLocalPath(repoData.owner.login, repoData.name);
  const resolved: ResolvedRepo = {
    fullName: repoData.full_name,
    owner: repoData.owner.login,
    name: repoData.name,
    localPath,
    worktreePath: join(localPath, "..", ".oac-worktrees", repoData.default_branch),
    meta: {
      defaultBranch: repoData.default_branch,
      language: repoData.language,
      languages,
      size: repoData.size,
      stars: repoData.stargazers_count,
      openIssuesCount: repoData.open_issues_count,
      topics: repoData.topics ?? [],
      license: normalizeLicense(repoData.license?.spdx_id ?? null),
      isArchived: repoData.archived,
      isFork: repoData.fork,
      permissions,
    },
    git: {
      headSha,
      remoteUrl: repoData.clone_url ?? `https://github.com/${repoData.full_name}.git`,
      isShallowClone: true,
    },
  };

  await cache.set(resolved.fullName, resolved);
  return resolved;
}

function parseRepoInput(input: string): ParsedRepoInput {
  const normalized = input.trim();
  if (!normalized) {
    throw new RepoResolutionError("Repository input cannot be empty.", "INVALID_INPUT");
  }

  const ownerRepoMatch = normalized.match(OWNER_REPO_PATTERN);
  if (ownerRepoMatch?.groups) {
    return {
      owner: ownerRepoMatch.groups.owner,
      name: ownerRepoMatch.groups.repo,
    };
  }

  const sshMatch = normalized.match(GITHUB_SSH_PATTERN);
  if (sshMatch?.groups) {
    return {
      owner: sshMatch.groups.owner,
      name: sshMatch.groups.repo,
    };
  }

  const normalizedUrlInput = normalized.startsWith("github.com/")
    ? `https://${normalized}`
    : normalized;

  try {
    const url = new URL(normalizedUrlInput);
    if (!isGitHubHost(url.hostname)) {
      throw new RepoResolutionError(
        `Only github.com repository URLs are supported, received "${url.hostname}".`,
        "INVALID_INPUT",
      );
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      throw new RepoResolutionError(`Invalid GitHub repository URL "${input}".`, "INVALID_INPUT");
    }

    const owner = pathParts[0];
    const name = stripGitSuffix(pathParts[1]);
    if (!owner || !name) {
      throw new RepoResolutionError(`Invalid GitHub repository URL "${input}".`, "INVALID_INPUT");
    }

    return { owner, name };
  } catch (error) {
    if (error instanceof RepoResolutionError) {
      throw error;
    }

    throw new RepoResolutionError(
      `Expected "owner/repo" or a GitHub repository URL, received "${input}".`,
      "INVALID_INPUT",
      error,
    );
  }
}

async function fetchRepo(octokit: Octokit, owner: string, repo: string) {
  try {
    return (await octokit.repos.get({ owner, repo })).data;
  } catch (error) {
    throw toResolutionError(owner, repo, error);
  }
}

async function fetchLanguages(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Record<string, number>> {
  try {
    const response = await octokit.repos.listLanguages({ owner, repo });
    return response.data;
  } catch (error) {
    throw toResolutionError(owner, repo, error);
  }
}

async function fetchHeadSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string,
): Promise<string> {
  try {
    const branch = await octokit.repos.getBranch({
      owner,
      repo,
      branch: defaultBranch,
    });
    return branch.data.commit.sha;
  } catch (error) {
    throw toResolutionError(owner, repo, error);
  }
}

function toResolutionError(owner: string, repo: string, error: unknown): RepoResolutionError {
  const fullName = `${owner}/${repo}`;
  const status = isApiError(error) ? error.status : undefined;
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "unknown error";

  if (status === 404) {
    return new RepoResolutionError(
      `Repository "${fullName}" was not found on GitHub.`,
      "NOT_FOUND",
      error,
    );
  }

  if (status === 403) {
    return new RepoResolutionError(
      `Access denied while resolving "${fullName}". Check GITHUB_TOKEN permissions.`,
      "FORBIDDEN",
      error,
    );
  }

  return new RepoResolutionError(
    `Failed to resolve repository "${fullName}": ${message}`,
    "UNKNOWN",
    error,
  );
}

function normalizePermissions(
  isPrivateRepo: boolean,
  permissions:
    | {
        admin?: boolean;
        push?: boolean;
        pull?: boolean;
      }
    | undefined,
): RepoPermissions {
  const pull = permissions?.pull ?? !isPrivateRepo;

  return {
    push: permissions?.push ?? false,
    pull,
    admin: permissions?.admin ?? false,
  };
}

function normalizeLicense(spdxId: string | null): string | null {
  if (!spdxId || spdxId === "NOASSERTION") {
    return null;
  }

  return spdxId;
}

function isGitHubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "github.com" || normalized === "www.github.com";
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

function isApiError(error: unknown): error is { status?: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

function defaultLocalPath(owner: string, name: string): string {
  return join(homedir(), ".oac", "cache", "repos", owner, name);
}
