import { describe, expect, it } from "vitest";
import type {
  RepoPermissions,
  ResolvedRepo,
  ResolvedRepoGitState,
  ResolvedRepoMeta,
} from "../../src/repo/types.js";

describe("RepoPermissions", () => {
  it("accepts a valid permissions object", () => {
    const perms: RepoPermissions = { push: true, pull: true, admin: false };
    expect(perms.push).toBe(true);
    expect(perms.pull).toBe(true);
    expect(perms.admin).toBe(false);
  });
});

describe("ResolvedRepoMeta", () => {
  it("accepts a valid meta object with all fields", () => {
    const meta: ResolvedRepoMeta = {
      defaultBranch: "main",
      language: "TypeScript",
      languages: { TypeScript: 80, JavaScript: 20 },
      size: 1024,
      stars: 42,
      openIssuesCount: 5,
      topics: ["cli", "oss"],
      license: "MIT",
      isArchived: false,
      isFork: false,
      permissions: { push: true, pull: true, admin: false },
    };

    expect(meta.defaultBranch).toBe("main");
    expect(meta.language).toBe("TypeScript");
    expect(meta.languages).toEqual({ TypeScript: 80, JavaScript: 20 });
    expect(meta.size).toBe(1024);
    expect(meta.stars).toBe(42);
    expect(meta.openIssuesCount).toBe(5);
    expect(meta.topics).toEqual(["cli", "oss"]);
    expect(meta.license).toBe("MIT");
    expect(meta.isArchived).toBe(false);
    expect(meta.isFork).toBe(false);
    expect(meta.permissions.pull).toBe(true);
  });

  it("accepts null for nullable fields", () => {
    const meta: ResolvedRepoMeta = {
      defaultBranch: "main",
      language: null,
      languages: {},
      size: 0,
      stars: 0,
      openIssuesCount: 0,
      topics: [],
      license: null,
      isArchived: false,
      isFork: false,
      permissions: { push: false, pull: true, admin: false },
    };

    expect(meta.language).toBeNull();
    expect(meta.license).toBeNull();
  });
});

describe("ResolvedRepoGitState", () => {
  it("accepts a valid git state with required fields only", () => {
    const git: ResolvedRepoGitState = {
      headSha: "abc123",
      remoteUrl: "https://github.com/owner/repo.git",
      isShallowClone: true,
    };

    expect(git.headSha).toBe("abc123");
    expect(git.remoteUrl).toBe("https://github.com/owner/repo.git");
    expect(git.isShallowClone).toBe(true);
    expect(git.sshUrl).toBeUndefined();
  });

  it("accepts optional sshUrl", () => {
    const git: ResolvedRepoGitState = {
      headSha: "abc123",
      remoteUrl: "https://github.com/owner/repo.git",
      sshUrl: "git@github.com:owner/repo.git",
      isShallowClone: false,
    };

    expect(git.sshUrl).toBe("git@github.com:owner/repo.git");
  });
});

describe("ResolvedRepo", () => {
  it("accepts a fully populated repo object", () => {
    const repo: ResolvedRepo = {
      fullName: "owner/repo",
      owner: "owner",
      name: "repo",
      localPath: "/home/user/.oac/cache/repos/owner/repo",
      worktreePath: "/home/user/.oac/cache/repos/owner/.oac-worktrees/main",
      meta: {
        defaultBranch: "main",
        language: "TypeScript",
        languages: { TypeScript: 100 },
        size: 512,
        stars: 10,
        openIssuesCount: 2,
        topics: ["tool"],
        license: "Apache-2.0",
        isArchived: false,
        isFork: false,
        permissions: { push: true, pull: true, admin: true },
      },
      git: {
        headSha: "deadbeef",
        remoteUrl: "https://github.com/owner/repo.git",
        sshUrl: "git@github.com:owner/repo.git",
        isShallowClone: true,
      },
    };

    expect(repo.fullName).toBe("owner/repo");
    expect(repo.owner).toBe("owner");
    expect(repo.name).toBe("repo");
    expect(repo.localPath).toContain("owner/repo");
    expect(repo.worktreePath).toContain(".oac-worktrees");
    expect(repo.meta.defaultBranch).toBe("main");
    expect(repo.git.headSha).toBe("deadbeef");
  });

  it("has mutable localPath and worktreePath (used by cloner)", () => {
    const repo: ResolvedRepo = {
      fullName: "owner/repo",
      owner: "owner",
      name: "repo",
      localPath: "/original",
      worktreePath: "/original-wt",
      meta: {
        defaultBranch: "main",
        language: null,
        languages: {},
        size: 0,
        stars: 0,
        openIssuesCount: 0,
        topics: [],
        license: null,
        isArchived: false,
        isFork: false,
        permissions: { push: false, pull: true, admin: false },
      },
      git: {
        headSha: "000000",
        remoteUrl: "https://github.com/owner/repo.git",
        isShallowClone: true,
      },
    };

    repo.localPath = "/updated";
    repo.worktreePath = "/updated-wt";
    expect(repo.localPath).toBe("/updated");
    expect(repo.worktreePath).toBe("/updated-wt");
  });
});
