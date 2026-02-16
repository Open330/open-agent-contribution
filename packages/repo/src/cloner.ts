import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { ResolvedRepo } from "./types.js";

const CLONE_RETRY_BACKOFF_MS = [1000, 4000, 16000] as const;

export const DEFAULT_REPO_CACHE_DIR = join(homedir(), ".oac", "cache", "repos");

export async function cloneRepo(
  repo: ResolvedRepo,
  cacheDir: string = DEFAULT_REPO_CACHE_DIR,
): Promise<string> {
  const cacheRoot = resolveCacheDir(cacheDir);
  const localPath = join(cacheRoot, repo.owner, repo.name);
  await mkdir(dirname(localPath), { recursive: true });

  if (await isGitRepository(localPath)) {
    await pullExistingClone(repo, localPath);
  } else if (await pathExists(localPath)) {
    throw new Error(
      `Cannot clone "${repo.fullName}" into "${localPath}" because the directory exists and is not a git repository.`,
    );
  } else {
    await cloneNewRepository(repo, localPath);
  }

  const git = simpleGit(localPath);
  repo.localPath = localPath;
  repo.worktreePath = join(localPath, "..", ".oac-worktrees", repo.meta.defaultBranch);
  repo.git.headSha = (await git.revparse(["HEAD"])).trim();
  repo.git.isShallowClone = await isShallowClone(git);
  repo.git.remoteUrl = await getOriginUrl(git, repo.git.remoteUrl);

  return localPath;
}

async function cloneNewRepository(
  repo: ResolvedRepo,
  localPath: string,
): Promise<void> {
  const git = simpleGit();
  await retryGitOperation(
    () =>
      git.clone(repo.git.remoteUrl, localPath, [
        "--depth",
        "1",
        "--branch",
        repo.meta.defaultBranch,
      ]),
    `clone ${repo.fullName}`,
  );
}

async function pullExistingClone(
  repo: ResolvedRepo,
  localPath: string,
): Promise<void> {
  const git = simpleGit(localPath);
  await ensureOriginRemote(git, repo.git.remoteUrl);

  await retryGitOperation(
    () => git.fetch("origin", repo.meta.defaultBranch, ["--depth=1"]),
    `fetch ${repo.fullName}`,
  );

  await checkoutDefaultBranch(git, repo.meta.defaultBranch);

  await retryGitOperation(
    () => git.pull("origin", repo.meta.defaultBranch, ["--ff-only"]),
    `pull ${repo.fullName}`,
  );
}

async function checkoutDefaultBranch(
  git: SimpleGit,
  branchName: string,
): Promise<void> {
  try {
    await git.checkout(branchName);
  } catch {
    await git.raw(["checkout", "-B", branchName, `origin/${branchName}`]);
  }
}

async function ensureOriginRemote(git: SimpleGit, remoteUrl: string): Promise<void> {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");

  if (!origin) {
    await git.addRemote("origin", remoteUrl);
    return;
  }

  if (origin.refs.fetch !== remoteUrl && origin.refs.push !== remoteUrl) {
    await git.remote(["set-url", "origin", remoteUrl]);
  }
}

async function getOriginUrl(git: SimpleGit, fallbackUrl: string): Promise<string> {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");
  return origin?.refs.fetch ?? fallbackUrl;
}

async function isShallowClone(git: SimpleGit): Promise<boolean> {
  const output = await git.raw(["rev-parse", "--is-shallow-repository"]);
  return output.trim() === "true";
}

async function retryGitOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= CLONE_RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === CLONE_RETRY_BACKOFF_MS.length) {
        break;
      }
      await sleep(CLONE_RETRY_BACKOFF_MS[attempt]);
    }
  }

  throw new Error(
    `Git operation failed after ${
      CLONE_RETRY_BACKOFF_MS.length + 1
    } attempts (${operationName}).`,
    { cause: lastError },
  );
}

function resolveCacheDir(cacheDir: string): string {
  const selected = cacheDir.trim().length > 0 ? cacheDir : DEFAULT_REPO_CACHE_DIR;
  return resolve(expandHomePath(selected));
}

function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepository(path: string): Promise<boolean> {
  return pathExists(join(path, ".git"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
