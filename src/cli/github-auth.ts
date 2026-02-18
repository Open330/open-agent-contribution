import { execFileSync, spawnSync } from "node:child_process";

/**
 * Ensures GITHUB_TOKEN is set in process.env for Octokit API calls.
 * Tries: GITHUB_TOKEN → GH_TOKEN → `gh auth token`.
 * Call this before any GitHub API usage (resolveRepo, etc.).
 */
export function ensureGitHubAuth(): string | undefined {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    process.env.GITHUB_TOKEN = githubToken;
    return githubToken;
  }

  const ghToken = process.env.GH_TOKEN?.trim();
  if (ghToken) {
    process.env.GITHUB_TOKEN = ghToken;
    return ghToken;
  }

  try {
    const token = execFileSync("gh", ["auth", "token"], {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (token.length > 0) {
      process.env.GITHUB_TOKEN = token;
      return token;
    }
  } catch {
    // gh not installed or not authenticated
  }

  return undefined;
}

/**
 * Checks whether the current gh auth has the required scopes.
 * Returns missing scopes or empty array if all present.
 *
 * Minimum required scopes:
 *   - **repo** — read/write access to repository contents, issues, and PRs.
 *     This single scope covers all OAC operations: cloning private repos,
 *     creating branches, pushing commits, and opening pull requests.
 *
 * Note: `gh auth status` outputs scope info to stderr, so we use spawnSync
 * to capture both stdout and stderr without spawning a shell.
 */
export function checkGitHubScopes(required: string[] = ["repo"]): string[] {
  try {
    // gh auth status writes scope info to stderr, so we use spawnSync
    // to capture both stdout and stderr without spawning a shell.
    const result = spawnSync("gh", ["auth", "status"], {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    // Match: Token scopes: 'admin:org', 'gist', 'repo', 'workflow'
    const scopeLine = combined.match(/Token scopes:\s*(.+)/);
    if (!scopeLine) return [];

    const scopes = scopeLine[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    return required.filter((r) => !scopes.includes(r));
  } catch {
    return [];
  }
}
