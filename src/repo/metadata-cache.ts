import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolvedRepo } from "./types.js";

interface MetadataCacheEntry {
  cachedAt: number;
  repo: ResolvedRepo;
}

interface MetadataCacheFile {
  version: 1;
  entries: Record<string, MetadataCacheEntry>;
}

export interface MetadataCacheOptions {
  filePath?: string;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_METADATA_CACHE_PATH = join(homedir(), ".oac", "cache", "repos.json");

export const DEFAULT_METADATA_CACHE_TTL_MS = 60 * 60 * 1000;

const EMPTY_CACHE: MetadataCacheFile = {
  version: 1,
  entries: {},
};

export class MetadataCache {
  private readonly filePath: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  public constructor(options: MetadataCacheOptions = {}) {
    this.filePath = expandHomePath(options.filePath ?? DEFAULT_METADATA_CACHE_PATH);
    this.ttlMs = options.ttlMs ?? DEFAULT_METADATA_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  public async get(fullName: string): Promise<ResolvedRepo | null> {
    const cache = await this.readCache();
    const key = normalizeCacheKey(fullName);
    const entry = cache.entries[key];

    if (!entry) {
      return null;
    }

    if (this.now() - entry.cachedAt > this.ttlMs) {
      delete cache.entries[key];
      await this.writeCache(cache);
      return null;
    }

    return entry.repo;
  }

  public async set(fullName: string, repo: ResolvedRepo): Promise<void> {
    const cache = await this.readCache();
    const key = normalizeCacheKey(fullName);
    cache.entries[key] = {
      cachedAt: this.now(),
      repo,
    };
    await this.writeCache(cache);
  }

  public async invalidate(fullName?: string): Promise<void> {
    if (!fullName) {
      await this.writeCache(EMPTY_CACHE);
      return;
    }

    const cache = await this.readCache();
    const key = normalizeCacheKey(fullName);
    if (!(key in cache.entries)) {
      return;
    }

    delete cache.entries[key];
    await this.writeCache(cache);
  }

  private async readCache(): Promise<MetadataCacheFile> {
    if (!(await pathExists(this.filePath))) {
      return { ...EMPTY_CACHE, entries: {} };
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<MetadataCacheFile>;

      if (parsed.version !== 1 || typeof parsed.entries !== "object") {
        return { ...EMPTY_CACHE, entries: {} };
      }

      return {
        version: 1,
        entries: parsed.entries as Record<string, MetadataCacheEntry>,
      };
    } catch {
      return { ...EMPTY_CACHE, entries: {} };
    }
  }

  private async writeCache(cache: MetadataCacheFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(cache, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

function normalizeCacheKey(fullName: string): string {
  return fullName.trim().toLowerCase();
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
