import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Epic } from "../core/types.js";
import type { Backlog } from "./context-types.js";

const DEFAULT_CONTEXT_DIR = ".oac/context";

/**
 * Persist the backlog to disk with atomic write (temp file + rename).
 * Creates the directory if it doesn't exist.
 * Returns the path to the written file.
 */
export async function persistBacklog(
  repoPath: string,
  backlog: Backlog,
  contextDir?: string,
): Promise<string> {
  const path = join(repoPath, contextDir ?? DEFAULT_CONTEXT_DIR, "backlog.json");
  await mkdir(dirname(path), { recursive: true });

  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(backlog, null, 2), "utf8");
  await rename(tempPath, path);

  return path;
}

/**
 * Load the backlog from disk. Returns null if file doesn't exist.
 */
export async function loadBacklog(repoPath: string, contextDir?: string): Promise<Backlog | null> {
  const path = join(repoPath, contextDir ?? DEFAULT_CONTEXT_DIR, "backlog.json");

  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as Backlog;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // JSON parse error or other unexpected read error — treat as corrupted
    if (err instanceof SyntaxError) {
      return null;
    }
    return null;
  }
}

/**
 * Create a new backlog from scratch.
 */
export function createBacklog(repoFullName: string, headSha: string, epics: Epic[]): Backlog {
  return {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    repoFullName,
    headSha,
    epics,
  };
}

/**
 * Update an existing backlog:
 * - Add new epics (dedup by id)
 * - Mark epics as completed
 * - Preserve completed/skipped status from previous runs
 * Returns a new Backlog object (immutable update).
 */
export function updateBacklog(
  existing: Backlog,
  newEpics: Epic[],
  completedEpicIds: string[],
  headSha?: string,
): Backlog {
  const epicMap = new Map<string, Epic>();

  // Seed with existing epics
  for (const epic of existing.epics) {
    epicMap.set(epic.id, { ...epic });
  }

  // Mark completed epics
  for (const id of completedEpicIds) {
    const epic = epicMap.get(id);
    if (epic) {
      epic.status = "completed";
      epic.completedAt = new Date().toISOString();
    }
  }

  // Merge new epics: add if missing, update if pending
  for (const epic of newEpics) {
    const existing = epicMap.get(epic.id);
    if (!existing) {
      epicMap.set(epic.id, { ...epic });
    } else if (existing.status === "pending") {
      epicMap.set(epic.id, { ...epic });
    }
    // If existing is completed or skipped, preserve that status
  }

  const epics = Array.from(epicMap.values());

  return {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    repoFullName: existing.repoFullName,
    headSha: headSha ?? existing.headSha,
    epics,
  };
}

/**
 * Get pending epics from a backlog, sorted by priority descending.
 */
export function getPendingEpics(backlog: Backlog): Epic[] {
  return backlog.epics
    .filter((e) => e.status === "pending")
    .sort((a, b) => b.priority - a.priority);
}
