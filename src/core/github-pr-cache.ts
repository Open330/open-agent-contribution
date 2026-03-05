const GITHUB_API_BASE_URL = "https://api.github.com";
const OAC_PR_PAGE_SIZE = 100;
const OAC_PR_TITLE_PREFIX = "[OAC]";
const ISSUE_REF_PATTERN = /(?:Fixes|Closes|Resolves)\s+#(\d+)/gi;

export interface OacPRInfo {
  number: number | undefined;
  title: string;
  claimedIssueNumbers: number[];
}

/**
 * Fetches all open OAC pull requests for a repository and returns
 * parsed PR metadata. Shared by the scanner (deduplication during
 * discovery) and the PR module (pre-PR guard).
 */
export async function fetchOpenOacPRs(
  repoFullName: string,
  token: string,
): Promise<OacPRInfo[]> {
  const url =
    `${GITHUB_API_BASE_URL}/repos/${repoFullName}` +
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
      return [];
    }

    const pulls: unknown = await response.json();
    if (!Array.isArray(pulls)) {
      return [];
    }

    return parseOacPRs(pulls);
  } catch {
    return [];
  }
}

/**
 * Convenience: returns a set of issue numbers already claimed by open OAC PRs.
 */
export function extractClaimedIssueNumbers(prs: OacPRInfo[]): Set<number> {
  const claimed = new Set<number>();
  for (const pr of prs) {
    for (const num of pr.claimedIssueNumbers) {
      claimed.add(num);
    }
  }
  return claimed;
}

/**
 * Convenience: finds an existing OAC PR targeting a specific issue number.
 * Returns the PR number if found.
 */
export function findOacPRForIssue(
  prs: OacPRInfo[],
  issueNumber: number,
): number | undefined {
  for (const pr of prs) {
    if (pr.claimedIssueNumbers.includes(issueNumber)) {
      return pr.number;
    }
  }
  return undefined;
}

/**
 * Convenience: finds an existing OAC PR with the exact given title.
 * Returns the PR number if found.
 */
export function findOacPRByTitle(
  prs: OacPRInfo[],
  title: string,
): number | undefined {
  for (const pr of prs) {
    if (pr.title === title) {
      return pr.number;
    }
  }
  return undefined;
}

function parseOacPRs(pulls: unknown[]): OacPRInfo[] {
  const result: OacPRInfo[] = [];

  for (const pr of pulls) {
    if (!pr || typeof pr !== "object") continue;

    const record = pr as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    if (!title.startsWith(OAC_PR_TITLE_PREFIX)) continue;

    const prNumber = typeof record.number === "number" ? record.number : undefined;
    const body = typeof record.body === "string" ? record.body : "";
    const claimedIssueNumbers: number[] = [];

    for (const match of body.matchAll(ISSUE_REF_PATTERN)) {
      const num = Number.parseInt(match[1], 10);
      if (Number.isFinite(num)) {
        claimedIssueNumbers.push(num);
      }
    }

    result.push({ number: prNumber, title, claimedIssueNumbers });
  }

  return result;
}
