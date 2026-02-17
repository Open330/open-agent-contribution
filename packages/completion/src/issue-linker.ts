import type { Octokit } from "@octokit/rest";
import { type ResolvedRepo, type Task, completionError } from "@open330/oac-core";

import type { CreatedPR } from "./types.js";

export async function linkIssueToePR(
  repo: ResolvedRepo,
  task: Task,
  pr: CreatedPR,
  octokit: Octokit,
): Promise<void> {
  if (!task.linkedIssue) {
    return;
  }

  const issueNumber = task.linkedIssue.number;

  try {
    const issue = await octokit.issues.get({
      owner: repo.owner,
      repo: repo.name,
      issue_number: issueNumber,
    });

    if (issue.data.state === "closed") {
      return;
    }

    await octokit.issues.createComment({
      owner: repo.owner,
      repo: repo.name,
      issue_number: issueNumber,
      body: `OAC opened a PR for this issue: ${pr.url}`,
    });
  } catch (error) {
    if (isNonBlockingIssueError(error)) {
      return;
    }

    throw completionError(
      "PR_CREATION_FAILED",
      `Failed to link issue #${issueNumber} to PR #${pr.number}.`,
      {
        cause: error,
        context: {
          repo: repo.fullName,
          issueNumber,
          prNumber: pr.number,
        },
      },
    );
  }
}

export const linkIssueToPR = linkIssueToePR;

function isNonBlockingIssueError(error: unknown): boolean {
  if (!isStatusError(error)) {
    return false;
  }

  return error.status === 404 || error.status === 410 || error.status === 422;
}

function isStatusError(error: unknown): error is { status?: number } {
  return typeof error === "object" && error !== null && "status" in error;
}
