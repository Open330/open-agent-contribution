import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { ChalkInstance } from "chalk";

import type { OacConfig } from "../../../core/index.js";
import { ConfigError } from "./types.js";
import type { ContextAck } from "./types.js";

export async function resolveContextAck(
  repoPath: string,
  config: OacConfig | null,
  ui: ChalkInstance,
  suppressOutput: boolean,
): Promise<ContextAck | undefined> {
  const mode = config?.context.mode ?? "off";
  if (mode === "off") {
    return undefined;
  }

  const requiredGlobs = (config?.context.requiredGlobs ?? []).filter(
    (item) => item.trim().length > 0,
  );
  if (requiredGlobs.length === 0) {
    return undefined;
  }

  const files = await collectFilesForGlobs(repoPath, requiredGlobs);
  if (files.length === 0) {
    const message = `Missing required context files for run policy (${requiredGlobs.join(
      ", ",
    )}). Create repository-owned markdown plans under .context/plans and retry.`;
    if (mode === "enforce") {
      throw new ConfigError(message);
    }

    if (!suppressOutput) {
      console.warn(ui.yellow(`[oac] Context policy warning: ${message}`));
    }
    return undefined;
  }

  const maxItems = config?.context.maxAckItems ?? 3;
  const summary = await summarizeContextFiles(repoPath, files.slice(0, maxItems));
  const digest = await hashContextFiles(repoPath, files);

  if (!suppressOutput) {
    console.log(
      ui.blue(
        `[oac] Context policy loaded ${files.length} file(s): ${files.slice(0, maxItems).join(", ")}`,
      ),
    );
  }

  return {
    mode,
    requiredGlobs,
    files,
    summary,
    digest,
  };
}

async function collectFilesForGlobs(repoPath: string, globs: string[]): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of globs) {
    const root = resolveSearchRoot(repoPath, pattern);
    const rootStat = await safeStat(root);
    if (!rootStat?.isDirectory()) continue;

    const candidates = await listFilesRecursively(root);
    const matcher = createSimpleGlobMatcher(pattern);
    for (const candidate of candidates) {
      const relPath = toPosixPath(relative(repoPath, candidate));
      if (matcher(relPath)) {
        files.add(relPath);
      }
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

function resolveSearchRoot(repoPath: string, pattern: string): string {
  const normalized = toPosixPath(pattern);
  const wildcardIndex = normalized.search(/[\[*?]/);
  const prefix = wildcardIndex === -1 ? normalized : normalized.slice(0, wildcardIndex);
  const cleanedPrefix = prefix.replace(/\/+$|\/+$/g, "");
  const fallback = ".";
  return resolve(repoPath, cleanedPrefix.length > 0 ? cleanedPrefix : fallback);
}

function createSimpleGlobMatcher(pattern: string): (path: string) => boolean {
  const tokenized = toPosixPath(pattern)
    .replaceAll("**/", "::DOUBLE_STAR_DIR::")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "::STAR::")
    .replaceAll("?", "::QUESTION::");

  const escaped = tokenized
    .replace(/[\\.^$+{}()|[\]]/g, "\\$&")
    .replaceAll("::DOUBLE_STAR_DIR::", "(?:.*/)?")
    .replaceAll("::DOUBLE_STAR::", ".*")
    .replaceAll("::STAR::", "[^/]*")
    .replaceAll("::QUESTION::", "[^/]");

  const regex = new RegExp(`^${escaped}$`);
  return (path: string): boolean => regex.test(toPosixPath(path));
}

async function listFilesRecursively(rootDir: string): Promise<string[]> {
  const output: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }

  return output;
}

async function summarizeContextFiles(repoPath: string, relPaths: string[]): Promise<string[]> {
  const lines: string[] = [];

  for (const relPath of relPaths) {
    const fullPath = resolve(repoPath, relPath);
    const content = await readFile(fullPath, "utf8");
    const condensed = content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => line.startsWith("#") || line.startsWith("-") || line.startsWith("*"));

    const selected = condensed.slice(0, 3);
    if (selected.length > 0) {
      lines.push(`${relPath}: ${selected.join(" | ")}`);
    }
  }

  return lines;
}

async function hashContextFiles(repoPath: string, relPaths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relPath of relPaths) {
    const fullPath = resolve(repoPath, relPath);
    const content = await readFile(fullPath, "utf8");
    hash.update(relPath);
    hash.update("\n");
    hash.update(content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function safeStat(path: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}
