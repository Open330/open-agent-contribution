import { execFileSync } from "node:child_process";

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
 * Note: `gh auth status` outputs scope info to stderr, so we
 * redirect stderr to stdout to capture it.
 */
export function checkGitHubScopes(required: string[] = ["repo"]): string[] {
  try {
    // gh auth status prints token info to stderr
    const output = execFileSync("gh", ["auth", "status"], {
      timeout: 5_000,
      encoding: "utf-8",
      // Merge stderr into stdout so we can read scope info
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Try stdout first, then if empty try running with shell redirect
    let combined = output;
    if (!combined.includes("Token scopes")) {
      // gh auth status writes to stderr — use shell to capture both
      try {
        combined = execFileSync("sh", ["-c", "gh auth status 2>&1"], {
          timeout: 5_000,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        return [];
      }
    }

    // Match: Token scopes: 'admin:org', 'gist', 'repo', 'workflow'
    const scopeLine = combined.match(/Token scopes:\s*(.+)/);
    if (!scopeLine) return [];

    const scopes = scopeLine[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    return required.filter((r) => !scopes.includes(r));
  } catch {
    return [];
  }
}
