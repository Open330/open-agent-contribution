import { execFileSync } from "node:child_process";

/**
 * Ensures GITHUB_TOKEN is set in process.env for Octokit API calls.
 * Tries: GITHUB_TOKEN → GH_TOKEN → `gh auth token`.
 * Call this before any GitHub API usage (resolveRepo, etc.).
 */
export function ensureGitHubAuth(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

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
 */
export function checkGitHubScopes(required: string[] = ["repo"]): string[] {
  try {
    const output = execFileSync("gh", ["auth", "status"], {
      timeout: 5_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const scopeMatch = output.match(/Token scopes:\s*'([^']+)'/);
    if (!scopeMatch) return [];

    const scopes = scopeMatch[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    return required.filter((r) => !scopes.includes(r));
  } catch {
    return [];
  }
}
