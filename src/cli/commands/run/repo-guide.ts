import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface RepoGuide {
  path: string;
  content: string;
  digest: string;
}

const GUIDE_PATH = ".oac/README.md";

export async function discoverRepoGuide(repoPath: string): Promise<RepoGuide | undefined> {
  const fullPath = join(repoPath, GUIDE_PATH);

  try {
    const s = await stat(fullPath);
    if (!s.isFile()) return undefined;
  } catch {
    return undefined;
  }

  const content = await readFile(fullPath, "utf8");
  if (content.trim().length === 0) return undefined;

  const digest = createHash("sha256").update(content).digest("hex");

  return { path: GUIDE_PATH, content, digest };
}
