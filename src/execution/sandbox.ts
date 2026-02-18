import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { simpleGit } from "simple-git";
import { executionError } from "../core/index.js";

export interface SandboxContext {
  path: string;
  branchName: string;
  cleanup(): Promise<void>;
}

/**
 * Mutex that serializes all git worktree operations (add/remove/prune)
 * to avoid .git/config lock races when running concurrent tasks.
 */
let worktreeLock = Promise.resolve();

function withWorktreeLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = worktreeLock.catch(() => {}).then(fn);
  worktreeLock = next.then(
    () => {},
    () => {},
  );
  return next;
}

function getWorktreePath(repoPath: string, branchName: string): string {
  return resolve(join(repoPath, "..", ".oac-worktrees", branchName));
}

/**
 * Allowed characters in branch names.
 * Prevents injection of arbitrary git arguments or path traversal.
 */
const SAFE_BRANCH_RE = /^[a-zA-Z0-9/_.-]+$/;

export async function createSandbox(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<SandboxContext> {
  if (!SAFE_BRANCH_RE.test(branchName)) {
    throw executionError("AGENT_EXECUTION_FAILED", `Invalid branch name: ${branchName}`);
  }
  if (!SAFE_BRANCH_RE.test(baseBranch)) {
    throw executionError("AGENT_EXECUTION_FAILED", `Invalid base branch name: ${baseBranch}`);
  }

  const worktreePath = getWorktreePath(repoPath, branchName);
  const worktreeRoot = resolve(join(repoPath, "..", ".oac-worktrees"));
  const git = simpleGit(repoPath);

  await withWorktreeLock(async () => {
    await mkdir(worktreeRoot, { recursive: true });
    await git.raw(["worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`]);
  });

  let cleanedUp = false;

  return {
    path: worktreePath,
    branchName,
    cleanup: async (): Promise<void> => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;

      await withWorktreeLock(async () => {
        try {
          await git.raw(["worktree", "remove", worktreePath, "--force"]);
        } finally {
          try {
            await git.raw(["worktree", "prune"]);
          } catch {
            // Ignore cleanup pruning errors.
          }
        }
      });
    },
  };
}
