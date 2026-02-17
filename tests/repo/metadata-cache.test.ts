import * as fsPromises from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataCache } from "../../src/repo/metadata-cache.js";
import type { ResolvedRepo } from "../../src/repo/types.js";

const fsMockState = vi.hoisted(() => ({
  rename: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: vi.fn(async (...args: Parameters<typeof original.rename>) => {
      fsMockState.rename(...args);
      return original.rename(...args);
    }),
  };
});

let tempDir = "";
let cachePath = "";
let nowMs = 1_700_000_000_000;

function makeResolvedRepo(fullName: string): ResolvedRepo {
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    owner,
    name,
    localPath: join(tempDir, "repos", owner, name),
    worktreePath: join(tempDir, ".oac-worktrees", "main"),
    meta: {
      defaultBranch: "main",
      language: "TypeScript",
      languages: { TypeScript: 100 },
      size: 123,
      stars: 5,
      openIssuesCount: 1,
      topics: ["oac"],
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
      headSha: "abc123def456",
      remoteUrl: `https://github.com/${fullName}.git`,
      isShallowClone: true,
    },
  };
}

function createCache(ttlMs = 1_000): MetadataCache {
  return new MetadataCache({
    filePath: cachePath,
    ttlMs,
    now: () => nowMs,
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsPromises.access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await mkdtemp(join(tmpdir(), "oac-metadata-cache-"));
  cachePath = join(tempDir, "repos.json");
  nowMs = 1_700_000_000_000;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("MetadataCache.get", () => {
  it("returns null for missing keys", async () => {
    const cache = createCache();
    await expect(cache.get("owner/repo")).resolves.toBeNull();
  });

  it("returns stored values after set()", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    await expect(cache.get("owner/repo")).resolves.toEqual(repo);
  });

  it("normalizes cache keys case-insensitively", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("Owner/Repo", repo);
    await expect(cache.get("owner/repo")).resolves.toEqual(repo);
  });

  it("normalizes cache keys by trimming whitespace", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("  owner/repo  ", repo);
    await expect(cache.get("OWNER/REPO")).resolves.toEqual(repo);
  });

  it("returns null when TTL is expired", async () => {
    const cache = createCache(1_000);
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    nowMs += 1_001;

    await expect(cache.get("owner/repo")).resolves.toBeNull();
  });

  it("returns the value when TTL is not expired", async () => {
    const cache = createCache(1_000);
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    nowMs += 999;

    await expect(cache.get("owner/repo")).resolves.toEqual(repo);
  });

  it("removes expired entries from disk on read", async () => {
    const cache = createCache(1_000);
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    nowMs += 1_001;

    await expect(cache.get("owner/repo")).resolves.toBeNull();

    const raw = JSON.parse(await readFile(cachePath, "utf8")) as {
      entries: Record<string, unknown>;
    };
    expect(raw.entries["owner/repo"]).toBeUndefined();
  });
});

describe("MetadataCache.invalidate", () => {
  it("removes only the specified key", async () => {
    const cache = createCache();
    const repoA = makeResolvedRepo("owner/repo-a");
    const repoB = makeResolvedRepo("owner/repo-b");

    await cache.set("owner/repo-a", repoA);
    await cache.set("owner/repo-b", repoB);
    await cache.invalidate("owner/repo-a");

    await expect(cache.get("owner/repo-a")).resolves.toBeNull();
    await expect(cache.get("owner/repo-b")).resolves.toEqual(repoB);
  });

  it("clears all entries when called without a key", async () => {
    const cache = createCache();
    const repoA = makeResolvedRepo("owner/repo-a");
    const repoB = makeResolvedRepo("owner/repo-b");

    await cache.set("owner/repo-a", repoA);
    await cache.set("owner/repo-b", repoB);
    await cache.invalidate();

    await expect(cache.get("owner/repo-a")).resolves.toBeNull();
    await expect(cache.get("owner/repo-b")).resolves.toBeNull();
  });

  it("does nothing for unknown keys", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    await cache.invalidate("owner/missing");

    await expect(cache.get("owner/repo")).resolves.toEqual(repo);
  });
});

describe("MetadataCache persistence", () => {
  it("creates the cache file on first write", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    expect(await fileExists(cachePath)).toBe(false);
    await cache.set("owner/repo", repo);
    expect(await fileExists(cachePath)).toBe(true);
  });

  it("returns empty results when the cache file is corrupt", async () => {
    const cache = createCache();

    await writeFile(cachePath, "{not-json", "utf8");
    await expect(cache.get("owner/repo")).resolves.toBeNull();
  });

  it("returns empty results when the cache file has a wrong version", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await writeFile(
      cachePath,
      JSON.stringify({
        version: 2,
        entries: {
          "owner/repo": {
            cachedAt: nowMs,
            repo,
          },
        },
      }),
      "utf8",
    );

    await expect(cache.get("owner/repo")).resolves.toBeNull();
  });
});

describe("MetadataCache writes", () => {
  it("performs atomic writes via temp file rename", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);

    expect(fsMockState.rename).toHaveBeenCalled();
    const [tempPath, finalPath] = fsMockState.rename.mock.calls[0] as [string, string];
    expect(tempPath).toBe(`${cachePath}.tmp`);
    expect(finalPath).toBe(cachePath);
  });

  it("cleans up temp files after successful writes", async () => {
    const cache = createCache();
    const repo = makeResolvedRepo("owner/repo");

    await cache.set("owner/repo", repo);
    expect(await fileExists(`${cachePath}.tmp`)).toBe(false);
  });
});
