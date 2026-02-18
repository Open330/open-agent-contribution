import type { ChalkInstance } from "chalk";
import Table from "cli-table3";
import { Command } from "commander";

import type { OacConfig } from "../../core/index.js";
import { analyzeCodebase, persistContext } from "../../discovery/analyzer.js";
import { createBacklog, persistBacklog } from "../../discovery/backlog.js";
import { groupFindingsIntoEpics } from "../../discovery/epic-grouper.js";
import {
  CompositeScanner,
  GitHubIssuesScanner,
  LintScanner,
  type Scanner,
  TestGapScanner,
  TodoScanner,
} from "../../discovery/index.js";
import { cloneRepo, resolveRepo } from "../../repo/index.js";
import { ensureGitHubAuth } from "../github-auth.js";

import {
  createSpinner,
  createUi,
  getGlobalOptions,
  loadOptionalConfig,
  resolveRepoInput,
  truncate,
} from "../helpers.js";

interface AnalyzeCommandOptions {
  repo?: string;
  force?: boolean;
  format: string;
}

type OutputFormat = "table" | "json";

export function createAnalyzeCommand(): Command {
  const command = new Command("analyze");

  command
    .description("Analyze repository and build context for epic-based planning")
    .option("--repo <owner/repo>", "Target repository (owner/repo or GitHub URL)")
    .option("--force", "Force re-analysis even if context is fresh", false)
    .option("--format <format>", "Output format: table|json", "table")
    .action(async (options: AnalyzeCommandOptions, cmd) => {
      const globalOptions = getGlobalOptions(cmd);
      const ui = createUi(globalOptions);
      const outputJson = globalOptions.json || normalizeOutputFormat(options.format) === "json";

      const config = await loadOptionalConfig(globalOptions.config, globalOptions.verbose, ui);
      const repoInput = resolveRepoInput(options.repo, config);
      const ghToken = ensureGitHubAuth();

      // Resolve and clone repo
      const resolveSpinner = createSpinner(outputJson, "Resolving repository...");
      const resolvedRepo = await resolveRepo(repoInput);
      resolveSpinner?.succeed(`Resolved ${resolvedRepo.fullName}`);

      const cloneSpinner = createSpinner(outputJson, "Preparing local clone...");
      await cloneRepo(resolvedRepo);
      cloneSpinner?.succeed(`Repository ready at ${resolvedRepo.localPath}`);

      // Build scanner list
      const scanners = buildScannerList(config, Boolean(ghToken));

      // Analyze codebase
      const analyzeSpinner = createSpinner(outputJson, "Analyzing codebase...");
      const { codebaseMap, qualityReport } = await analyzeCodebase(resolvedRepo.localPath, {
        scanners,
        repoFullName: resolvedRepo.fullName,
        headSha: resolvedRepo.git.headSha,
        exclude: config?.discovery.exclude,
      });
      analyzeSpinner?.succeed(
        `Analyzed ${codebaseMap.modules.length} modules, ${codebaseMap.totalFiles} files, ${qualityReport.findings.length} findings`,
      );

      // Group into epics
      const groupSpinner = createSpinner(outputJson, "Grouping findings into epics...");
      const epics = groupFindingsIntoEpics(qualityReport.findings, { codebaseMap });
      groupSpinner?.succeed(`Created ${epics.length} epic(s)`);

      // Persist everything
      const contextDir = config?.analyze?.contextDir ?? ".oac/context";
      const persistSpinner = createSpinner(outputJson, "Persisting context...");
      await persistContext(resolvedRepo.localPath, codebaseMap, qualityReport, contextDir);
      const backlog = createBacklog(resolvedRepo.fullName, resolvedRepo.git.headSha, epics);
      await persistBacklog(resolvedRepo.localPath, backlog, contextDir);
      persistSpinner?.succeed(`Context persisted to ${contextDir}/`);

      // Output
      if (outputJson) {
        console.log(
          JSON.stringify(
            {
              repo: resolvedRepo.fullName,
              modules: codebaseMap.modules.length,
              totalFiles: codebaseMap.totalFiles,
              totalLoc: codebaseMap.totalLoc,
              findings: qualityReport.summary,
              epics: epics.map((e) => ({
                id: e.id,
                title: e.title,
                scope: e.scope,
                subtasks: e.subtasks.length,
                priority: e.priority,
                status: e.status,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (epics.length === 0) {
        console.log(ui.yellow("No epics created — the codebase looks clean."));
        return;
      }

      const table = new Table({
        head: ["Epic", "Scope", "Subtasks", "Priority", "Status"],
      });

      for (const epic of epics) {
        table.push([
          truncate(epic.title, 55),
          epic.scope,
          String(epic.subtasks.length),
          String(epic.priority),
          epic.status,
        ]);
      }

      console.log(table.toString());
      console.log("");
      console.log(
        ui.blue(
          `${epics.length} epic(s) added to backlog. Use \`oac run --repo ${resolvedRepo.fullName}\` to execute.`,
        ),
      );
    });

  command.addHelpText(
    "after",
    `\nExamples:
  $ oac analyze --repo owner/repo
  $ oac analyze --repo owner/repo --force
  $ oac analyze --repo owner/repo --format json`,
  );

  return command;
}

// ── Helpers ───────────────────────────────────────────────────

function normalizeOutputFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "table" || normalized === "json") return normalized;
  throw new Error(`Unsupported --format value "${value}". Use "table" or "json".`);
}

function buildScannerList(config: OacConfig | null, hasGitHubAuth: boolean): Scanner[] {
  const scanners: Scanner[] = [];

  const lint = config?.discovery.scanners.lint ?? true;
  const todo = config?.discovery.scanners.todo ?? true;

  if (lint) scanners.push(new LintScanner());
  if (todo) scanners.push(new TodoScanner());
  scanners.push(new TestGapScanner());
  if (hasGitHubAuth) scanners.push(new GitHubIssuesScanner());

  return scanners;
}


