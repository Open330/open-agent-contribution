import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedRepo } from "../../src/repo/types.js";

const octokitMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  listLanguages: vi.fn(),
  getBranch: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation((options: unknown) => {
    octokitMocks.create(options);
    return {
      repos: {
        get: octokitMocks.get,
        listLanguages: octokitMocks.listLanguages,
        getBranch: octokitMocks.getBranch,
      },
    };
  }),
}));

vi.mock("node:child_process", () => ({
  execFileSync: childProcessMocks.execFileSync,
}));

vi.mock("../../src/repo/metadata-cache.js", () => ({
  MetadataCache: vi.fn().mockImplementation(() => ({
    get: cacheMocks.get,
    set: cacheMocks.set,
  })),
}));

import { RepoResolutionError, resolveRepo } from "../../src/repo/resolver.js";

function makeRepoData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "owner/repo",
    owner: { login: "owner" },
    name: "repo",
    default_branch: "main",
    language: "TypeScript",
    size: 42,
    stargazers_count: 7,
    open_issues_count: 3,
    topics: ["oac"],
    license: { spdx_id: "MIT" },
    archived: false,
    fork: false,
    private: false,
    permissions: { pull: true, push: false, admin: false },
    clone_url: "https://github.com/owner/repo.git",
    ssh_url: "git@github.com:owner/repo.git",
    ...overrides,
  };
}

function makeResolvedRepo(fullName = "cached/repo"): ResolvedRepo {
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    owner,
    name,
    localPath: `/tmp/${owner}/${name}`,
    worktreePath: `/tmp/${owner}/.oac-worktrees/main`,
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
        push: false,
        pull: true,
        admin: false,
      },
    },
    git: {
      headSha: "abc123def456",
      remoteUrl: `https://github.com/${fullName}.git`,
      sshUrl: `git@github.com:${fullName}.git`,
      isShallowClone: true,
    },
  };
}

async function expectParsedInput(
  input: string,
  expectedOwner: string,
  expectedRepo: string,
): Promise<void> {
  octokitMocks.get.mockResolvedValueOnce({
    data: makeRepoData({
      full_name: `${expectedOwner}/${expectedRepo}`,
      owner: { login: expectedOwner },
      name: expectedRepo,
    }),
  });

  const resolved = await resolveRepo(input);

  expect(cacheMocks.get).toHaveBeenCalledWith(`${expectedOwner}/${expectedRepo}`);
  expect(octokitMocks.get).toHaveBeenCalledWith({
    owner: expectedOwner,
    repo: expectedRepo,
  });
  expect(resolved.owner).toBe(expectedOwner);
  expect(resolved.name).toBe(expectedRepo);
}

beforeEach(() => {
  vi.clearAllMocks();

  childProcessMocks.execFileSync.mockReset();
  childProcessMocks.execFileSync.mockImplementation(() => {
    throw new Error("gh unavailable");
  });

  cacheMocks.get.mockResolvedValue(null);
  cacheMocks.set.mockResolvedValue(undefined);

  octokitMocks.get.mockResolvedValue({ data: makeRepoData() });
  octokitMocks.listLanguages.mockResolvedValue({
    data: { TypeScript: 100 },
  });
  octokitMocks.getBranch.mockResolvedValue({
    data: {
      commit: {
        sha: "abc123def456",
      },
    },
  });
});

afterEach(() => {
  process.env.GITHUB_TOKEN = undefined;
  process.env.GH_TOKEN = undefined;
});

describe("RepoResolutionError", () => {
  it("has the expected code, name, and message", () => {
    const cause = new Error("root cause");
    const error = new RepoResolutionError("boom", "INVALID_INPUT", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RepoResolutionError");
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toBe("boom");
    expect(error.cause).toBe(cause);
  });
});

describe("parseRepoInput via resolveRepo", () => {
  it("throws INVALID_INPUT for empty input", async () => {
    await expect(resolveRepo("   ")).rejects.toMatchObject({
      name: "RepoResolutionError",
      code: "INVALID_INPUT",
    });

    expect(cacheMocks.get).not.toHaveBeenCalled();
    expect(octokitMocks.get).not.toHaveBeenCalled();
  });

  it("parses owner/repo format", async () => {
    await expectParsedInput("octo/repo", "octo", "repo");
  });

  it("parses owner/repo.git and strips .git suffix", async () => {
    await expectParsedInput("octo/repo.git", "octo", "repo");
  });

  it("parses SSH format git@github.com:owner/repo.git", async () => {
    await expectParsedInput("git@github.com:octo/repo.git", "octo", "repo");
  });

  it("parses HTTPS URL format", async () => {
    await expectParsedInput("https://github.com/octo/repo", "octo", "repo");
  });

  it("parses URL with www.github.com", async () => {
    await expectParsedInput("https://www.github.com/octo/repo", "octo", "repo");
  });

  it("parses github.com/owner/repo without protocol", async () => {
    await expectParsedInput("github.com/octo/repo", "octo", "repo");
  });

  it("throws INVALID_INPUT for non-github hosts", async () => {
    await expect(resolveRepo("https://gitlab.com/octo/repo")).rejects.toMatchObject({
      name: "RepoResolutionError",
      code: "INVALID_INPUT",
    });

    expect(octokitMocks.get).not.toHaveBeenCalled();
  });

  it("throws INVALID_INPUT for malformed URL input", async () => {
    await expect(resolveRepo("totally invalid input")).rejects.toMatchObject({
      name: "RepoResolutionError",
      code: "INVALID_INPUT",
    });

    expect(octokitMocks.get).not.toHaveBeenCalled();
  });

  it("throws INVALID_INPUT for URL missing owner/repo path", async () => {
    await expect(resolveRepo("https://github.com/octo")).rejects.toMatchObject({
      name: "RepoResolutionError",
      code: "INVALID_INPUT",
    });

    expect(octokitMocks.get).not.toHaveBeenCalled();
  });
});

describe("normalizePermissions via resolveRepo", () => {
  it("keeps all explicit permissions", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        private: true,
        permissions: {
          pull: true,
          push: true,
          admin: true,
        },
      }),
    });

    const resolved = await resolveRepo("owner/repo");

    expect(resolved.meta.permissions).toEqual({
      pull: true,
      push: true,
      admin: true,
    });
  });

  it("defaults pull=true on public repos with undefined permissions", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        private: false,
        permissions: undefined,
      }),
    });

    const resolved = await resolveRepo("owner/repo");

    expect(resolved.meta.permissions).toEqual({
      pull: true,
      push: false,
      admin: false,
    });
  });

  it("defaults pull=false on private repos with undefined permissions", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        private: true,
        permissions: undefined,
      }),
    });

    await expect(resolveRepo("owner/repo")).rejects.toMatchObject({
      name: "RepoResolutionError",
      code: "FORBIDDEN",
      message: expect.stringContaining("Missing pull permission"),
    });

    expect(octokitMocks.listLanguages).not.toHaveBeenCalled();
    expect(octokitMocks.getBranch).not.toHaveBeenCalled();
  });
});

describe("normalizeLicense via resolveRepo", () => {
  it("maps null to null", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        license: null,
      }),
    });

    const resolved = await resolveRepo("owner/repo");
    expect(resolved.meta.license).toBeNull();
  });

  it("maps NOASSERTION to null", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        license: {
          spdx_id: "NOASSERTION",
        },
      }),
    });

    const resolved = await resolveRepo("owner/repo");
    expect(resolved.meta.license).toBeNull();
  });

  it("preserves SPDX IDs like MIT", async () => {
    octokitMocks.get.mockResolvedValueOnce({
      data: makeRepoData({
        license: {
          spdx_id: "MIT",
        },
      }),
    });

    const resolved = await resolveRepo("owner/repo");
    expect(resolved.meta.license).toBe("MIT");
  });
});

describe("cache behavior via resolveRepo", () => {
  it("returns cached values without calling Octokit", async () => {
    const cached = makeResolvedRepo("cached/repo");
    cacheMocks.get.mockResolvedValueOnce(cached);

    const resolved = await resolveRepo("cached/repo");

    expect(resolved).toBe(cached);
    expect(octokitMocks.get).not.toHaveBeenCalled();
    expect(octokitMocks.listLanguages).not.toHaveBeenCalled();
    expect(octokitMocks.getBranch).not.toHaveBeenCalled();
    expect(cacheMocks.set).not.toHaveBeenCalled();
  });
});

describe("GitHub auth token resolution", () => {
  it("uses GH_TOKEN when GITHUB_TOKEN is not set", async () => {
    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "gh-token-value";

    await resolveRepo("owner/repo");

    expect(octokitMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "gh-token-value" }),
    );
    expect(childProcessMocks.execFileSync).not.toHaveBeenCalled();
    expect(process.env.GITHUB_TOKEN).toBe("gh-token-value");
  });

  it("falls back to gh auth token when environment tokens are missing", async () => {
    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "";
    childProcessMocks.execFileSync.mockReturnValueOnce("gh-cli-token\n");

    await resolveRepo("owner/repo");

    expect(childProcessMocks.execFileSync).toHaveBeenCalledWith(
      "gh",
      ["auth", "token"],
      expect.objectContaining({
        timeout: 5_000,
        encoding: "utf-8",
      }),
    );
    expect(octokitMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "gh-cli-token" }),
    );
    expect(process.env.GITHUB_TOKEN).toBe("gh-cli-token");
  });
});
