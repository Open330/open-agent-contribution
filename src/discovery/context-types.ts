import type { Epic } from "../core/types.js";
import type { RawFinding } from "./types.js";

// ── Codebase Map ──────────────────────────────────────────────

export interface FileInfo {
  path: string;
  loc: number;
  sizeBytes: number;
  exports: string[];
  imports: string[];
}

export interface ModuleInfo {
  /** Module name derived from directory, e.g. "budget", "discovery" */
  name: string;
  /** Relative path from repo root, e.g. "src/budget" */
  path: string;
  files: FileInfo[];
  totalLoc: number;
  /** Aggregated exports from all files in the module */
  exports: string[];
  /** Other module names this module imports from */
  dependencies: string[];
}

export interface CodebaseMap {
  version: 1;
  generatedAt: string;
  repoFullName: string;
  headSha: string;
  modules: ModuleInfo[];
  totalFiles: number;
  totalLoc: number;
}

// ── Quality Report ────────────────────────────────────────────

export interface QualityReport {
  version: 1;
  generatedAt: string;
  repoFullName: string;
  findings: RawFinding[];
  summary: {
    totalFindings: number;
    bySource: Record<string, number>;
    byModule: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

// ── Backlog ───────────────────────────────────────────────────

export interface Backlog {
  version: 1;
  lastUpdatedAt: string;
  repoFullName: string;
  headSha: string;
  epics: Epic[];
}
