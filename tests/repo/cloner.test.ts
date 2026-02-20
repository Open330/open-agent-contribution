import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedRepo } from "../../src/repo/types.js";

const fsMockState = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
  mkdir: vi.fn(),
}));

const gitMockState = vi.hoisted(() => {
  const makeEnv = (git: Record<string, unknown>) => vi.fn().mockReturnValue(git);
  const rootGit: Record<string, unknown> = {
    clone: vi.fn(),
  };
  rootGit.env = makeEnv(rootGit);
  const repoGit: Record<string, unknown> = {
    fetch: vi.fn(),
    checkout: vi.fn(),
    pull: vi.fn(),
    raw: vi.fn(),
    getRemotes: vi.fn(),
    addRemote: vi.fn(),
    remote: vi.fn(),
    revparse: vi.fn(),
  };
  repoGit.env = makeEnv(repoGit);
  return { simpleGit: vi.fn(), rootGit, repoGit };
});

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async (path: string) => {
    if (!fsMockState.existingPaths.has(path)) {
      throw new Error("ENOENT");
    }
  }),
  mkdir: vi.fn(async (...args: Parameters<typeof fsMockState.mkdir>) => {
    fsMockState.mkdir(...args);
  }),
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn((pathOrOpts?: string | Record<string, unknown>) => {
    gitMockState.simpleGit(pathOrOpts);
    const baseDir =
      typeof pathOrOpts === "string" ? pathOrOpts : (pathOrOpts as Record<string, unknown>)?.baseDir;
    return baseDir ? gitMockState.repoGit : gitMockState.rootGit;
  }),
}));

import { cloneRepo } from "../../src/repo/cloner.js";

function makeResolvedRepo(overrides: Partial<ResolvedRepo> = {}): ResolvedRepo {
  return {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    localPath: "",
    worktreePath: "",
    meta: {
      defaultBranch: "main",
      language: "TypeScript",
      languages: { TypeScript: 100 },
      size: 1,
      stars: 1,
      openIssuesCount: 0,
      topics: [],
      license: "MIT",
      isArchived: false,
      isFork: false,
      permissions: {
        push: true,
        pull: true,
        admin: false,
      },
    },
    git: {
      headSha: "",
      remoteUrl: "https://github.com/owner/repo.git",
      isShallowClone: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMockState.existingPaths.clear();

  // Re-establish .env() chainable mock (vi.restoreAllMocks clears mockReturnValue)
  (gitMockState.rootGit.env as ReturnType<typeof vi.fn>).mockReturnValue(gitMockState.rootGit);
  (gitMockState.repoGit.env as ReturnType<typeof vi.fn>).mockReturnValue(gitMockState.repoGit);

  gitMockState.rootGit.clone.mockResolvedValue(undefined);

  gitMockState.repoGit.fetch.mockResolvedValue(undefined);
  gitMockState.repoGit.checkout.mockResolvedValue(undefined);
  gitMockState.repoGit.pull.mockResolvedValue(undefined);
  gitMockState.repoGit.addRemote.mockResolvedValue(undefined);
  gitMockState.repoGit.remote.mockResolvedValue(undefined);
  gitMockState.repoGit.getRemotes.mockResolvedValue([
    {
      name: "origin",
      refs: {
        fetch: "https://github.com/owner/repo.git",
        push: "https://github.com/owner/repo.git",
      },
    },
  ]);
  gitMockState.repoGit.revparse.mockResolvedValue("abc123\n");
  gitMockState.repoGit.raw.mockImplementation(async (args: string[]) => {
    if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") {
      return "true\n";
    }

    return "";
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloneRepo", () => {
  it("force-syncs existing cache clones to the remote default branch", async () => {
    const cacheDir = "/tmp/oac-cache";
    const localPath = join(cacheDir, "owner", "repo");
    fsMockState.existingPaths.add(localPath);
    fsMockState.existingPaths.add(join(localPath, ".git"));

    const repo = makeResolvedRepo();
    await cloneRepo(repo, cacheDir);

    expect(gitMockState.repoGit.fetch).toHaveBeenCalledWith("origin", "main", [
      "--depth=1",
      "--prune",
    ]);
    expect(gitMockState.repoGit.raw).toHaveBeenCalledWith(["reset", "--hard", "origin/main"]);
    expect(gitMockState.repoGit.raw).toHaveBeenCalledWith(["clean", "-fd"]);
    expect(gitMockState.repoGit.pull).not.toHaveBeenCalled();
  });

  it("throws when target directory exists but is not a git repository", async () => {
    const cacheDir = "/tmp/oac-cache";
    const localPath = join(cacheDir, "owner", "repo");
    fsMockState.existingPaths.add(localPath);

    const repo = makeResolvedRepo();
    await expect(cloneRepo(repo, cacheDir)).rejects.toThrow(
      `Cannot clone "owner/repo" into "${localPath}" because the directory exists and is not a git repository.`,
    );
  });

  it("clones a missing repository into the cache path", async () => {
    const cacheDir = "/tmp/oac-cache";
    const localPath = join(cacheDir, "owner", "repo");

    const repo = makeResolvedRepo();
    await cloneRepo(repo, cacheDir);

    expect(gitMockState.rootGit.clone).toHaveBeenCalledWith(
      "https://github.com/owner/repo.git",
      localPath,
      ["--depth", "1", "--branch", "main"],
    );
  });
});
