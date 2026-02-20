import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import type { ResolvedRepo } from "./types.js";

const CLONE_RETRY_BACKOFF_MS = [1000, 4000, 16000] as const;
const GIT_CLONE_TIMEOUT_MS = 300_000; // 5 min rolling timeout for clone
const GIT_FETCH_TIMEOUT_MS = 120_000; // 2 min rolling timeout for fetch/sync

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

  const git = createGit(localPath);
  repo.localPath = localPath;
  repo.worktreePath = join(localPath, "..", ".oac-worktrees", repo.meta.defaultBranch);
  repo.git.headSha = (await git.revparse(["HEAD"])).trim();
  repo.git.isShallowClone = await isShallowClone(git);
  repo.git.remoteUrl = await getOriginUrl(git, repo.git.remoteUrl);

  return localPath;
}

async function cloneNewRepository(repo: ResolvedRepo, localPath: string): Promise<void> {
  const git = createGit(undefined, GIT_CLONE_TIMEOUT_MS);
  const cloneArgs = ["--depth", "1", "--branch", repo.meta.defaultBranch];

  try {
    await retryGitOperation(
      () => git.clone(repo.git.remoteUrl, localPath, cloneArgs),
      `clone ${repo.fullName}`,
    );
  } catch (httpsError) {
    if (!repo.git.sshUrl) throw httpsError;

    // HTTPS failed — try SSH (e.g. user has SSH keys but no HTTPS credentials)
    await cleanPartialClone(localPath);
    try {
      await retryGitOperation(
        () => git.clone(repo.git.sshUrl!, localPath, cloneArgs),
        `clone ${repo.fullName} (SSH fallback)`,
      );
    } catch (sshError) {
      throw new Error(
        `Failed to clone "${repo.fullName}" via both HTTPS and SSH.\n` +
          "Ensure git credentials are configured: run `gh auth login` or set up SSH keys.\n" +
          `HTTPS error: ${httpsError instanceof Error ? httpsError.message : httpsError}\n` +
          `SSH error: ${sshError instanceof Error ? sshError.message : sshError}`,
        { cause: sshError },
      );
    }
  }
}

async function pullExistingClone(repo: ResolvedRepo, localPath: string): Promise<void> {
  const git = createGit(localPath);
  await ensureOriginRemote(git, repo.git.remoteUrl);

  try {
    await retryGitOperation(
      () => git.fetch("origin", repo.meta.defaultBranch, ["--depth=1", "--prune"]),
      `fetch ${repo.fullName}`,
    );
  } catch (fetchError) {
    if (!repo.git.sshUrl) throw fetchError;

    // HTTPS fetch failed — switch remote to SSH and retry
    await ensureOriginRemote(git, repo.git.sshUrl);
    await retryGitOperation(
      () => git.fetch("origin", repo.meta.defaultBranch, ["--depth=1", "--prune"]),
      `fetch ${repo.fullName} (SSH fallback)`,
    );
  }

  await checkoutDefaultBranch(git, repo.meta.defaultBranch);

  await retryGitOperation(
    () => hardSyncDefaultBranch(git, repo.meta.defaultBranch),
    `sync ${repo.fullName}`,
  );
}

async function checkoutDefaultBranch(git: SimpleGit, branchName: string): Promise<void> {
  try {
    await git.checkout(branchName);
  } catch {
    await git.raw(["checkout", "-B", branchName, `origin/${branchName}`]);
  }
}

async function hardSyncDefaultBranch(git: SimpleGit, branchName: string): Promise<void> {
  // The cache clone is disposable, so force-align it with origin to avoid stale divergence.
  await git.raw(["reset", "--hard", `origin/${branchName}`]);
  await git.raw(["clean", "-fd"]);
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
    `Git operation failed after ${CLONE_RETRY_BACKOFF_MS.length + 1} attempts (${operationName}).`,
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

/**
 * Create a `SimpleGit` instance with `GIT_TERMINAL_PROMPT=0` (prevents
 * silent credential prompts that hang forever) and a rolling timeout that
 * kills the spawned process if it produces no output for `timeoutMs`.
 *
 * NOTE: `simple-git`'s `.env(key, value)` **replaces** the entire process
 * environment.  We must spread `process.env` so the child git process still
 * has `HOME`, `PATH`, `SSH_AUTH_SOCK`, etc.
 */
function createGit(baseDir?: string, timeoutMs = GIT_FETCH_TIMEOUT_MS): SimpleGit {
  return simpleGit({
    ...(baseDir ? { baseDir } : {}),
    timeout: { block: timeoutMs },
  }).env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });
}

async function cleanPartialClone(localPath: string): Promise<void> {
  try {
    await rm(localPath, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup before SSH retry */
  }
}
