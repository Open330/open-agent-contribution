import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { simpleGit } from 'simple-git';

export interface SandboxContext {
  path: string;
  branchName: string;
  cleanup(): Promise<void>;
}

function getWorktreePath(repoPath: string, branchName: string): string {
  return resolve(join(repoPath, '..', '.oac-worktrees', branchName));
}

export async function createSandbox(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<SandboxContext> {
  const worktreePath = getWorktreePath(repoPath, branchName);
  const worktreeRoot = resolve(join(repoPath, '..', '.oac-worktrees'));
  const git = simpleGit(repoPath);

  await mkdir(worktreeRoot, { recursive: true });
  await git.raw([
    'worktree',
    'add',
    worktreePath,
    '-b',
    branchName,
    `origin/${baseBranch}`,
  ]);

  let cleanedUp = false;

  return {
    path: worktreePath,
    branchName,
    cleanup: async (): Promise<void> => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;

      try {
        await git.raw(['worktree', 'remove', worktreePath, '--force']);
      } finally {
        try {
          await git.raw(['worktree', 'prune']);
        } catch {
          // Ignore cleanup pruning errors.
        }
      }
    },
  };
}
