import type { OacConfig } from "../core/index.js";
import { CompositeScanner } from "./scanner.js";
import { GitHubIssuesScanner } from "./scanners/github-issues-scanner.js";
import { LintScanner } from "./scanners/lint-scanner.js";
import { TestGapScanner } from "./scanners/test-gap-scanner.js";
import { TodoScanner } from "./scanners/todo-scanner.js";
import type { Scanner } from "./types.js";

export type ScannerName = "lint" | "todo" | "test-gap" | "github-issues";

/**
 * Builds a list of scanner instances based on the user's config and
 * whether a GitHub token is available.
 *
 * This is the single source of truth for scanner construction, used by
 * `oac run` (both task and epic modes) and `oac analyze`.
 */
export function buildScanners(
  config: OacConfig | null,
  hasGitHubAuth: boolean,
): { names: ScannerName[]; instances: Scanner[]; composite: CompositeScanner } {
  const names: ScannerName[] = [];

  if (config?.discovery.scanners.lint !== false) {
    names.push("lint");
  }
  if (config?.discovery.scanners.todo !== false) {
    names.push("todo");
  }
  if (config?.discovery.scanners.testGap !== false) {
    names.push("test-gap");
  }
  if (hasGitHubAuth) {
    names.push("github-issues");
  }

  // If everything was explicitly disabled, fall back to defaults.
  if (names.length === 0) {
    names.push("lint", "todo", "test-gap");
  }

  const unique = [...new Set(names)];
  const instances: Scanner[] = unique.map(instantiateScanner);

  return { names: unique, instances, composite: new CompositeScanner(instances) };
}

function instantiateScanner(name: ScannerName): Scanner {
  switch (name) {
    case "lint":
      return new LintScanner();
    case "todo":
      return new TodoScanner();
    case "test-gap":
      return new TestGapScanner();
    case "github-issues":
      return new GitHubIssuesScanner();
  }
}
