# Changelog

All notable changes to OAC (Open Agent Contribution) are documented here.

## [Unreleased]

### Wave 8 — Final UX Polish
- **docs**: Auto-generated config reference from Zod schema (`docs/config-reference.md`)
- **docs**: Added this CHANGELOG

---

## [2026.4.2] — 2026-02-18

### Wave 7 — Quick Wins Bundle (`7c179a0`)
- **feat**: `oac r` alias for `oac run` (power-user shortcut)
- **feat**: Distinct exit codes for CI/CD integration:
  - `0` — all tasks succeeded or dry-run
  - `1` — unhandled error
  - `2` — config/validation error
  - `3` — every task/epic failed
  - `4` — partial success (some tasks failed)
- **feat**: Resettable token counters (`claudeCounter.reset()`, `codexCounter.reset()`) for correctness in long-lived processes
- **feat**: Progress percentages on long operations (file analysis, task estimation, epic execution)

### Wave 6 — Single-Command Pipeline (`156c7d2`)
- **feat**: `oac run` now performs the full scan → analyze → execute pipeline in one command
- **ux**: Clarified distinction between `oac scan` (discover tasks) and `oac analyze` (build context)

### Wave 5 — Run Module Decomposition (`aea2760`)
- **refactor**: Decomposed the 1,692-line `run.ts` monolith into `src/cli/commands/run/` with 8 focused modules:
  - `index.ts` — command definition and option parsing
  - `pipeline.ts` — top-level orchestration
  - `epic.ts` — epic-based execution flow
  - `task.ts` — single-task execution
  - `retry.ts` — `--retry-failed` pipeline
  - `output.ts` — summary rendering and JSON output
  - `validation.ts` — config and input validation
  - `types.ts` — shared types, exit codes, `ConfigError`

### Wave 4 — Timeout, Completion, & Retry (`cb1af6c`)
- **feat**: PR creation timeout (prevents hanging on GitHub API issues)
- **perf**: Replaced hand-rolled `runWithConcurrency` with `PQueue` for bounded parallelism
- **feat**: `oac completion` command for shell tab-completion (bash/zsh/fish)
- **feat**: `--retry-failed` flag to re-run only previously failed tasks

### Wave 3 — UX & CLI Improvements (`9869073`)
- **ux**: Usage examples in every `--help` screen
- **feat**: Global `--quiet` flag suppresses spinner/progress output (for CI pipelines)
- **ux**: Failed task/epic details included in run summary
- **perf**: Parallelized epic execution pipeline with bounded concurrency

### Wave 2 — Helpers, Parallelism, & Cleanup (`417fc85`)
- **refactor**: Extracted 11 duplicated helper functions into `src/cli/helpers.ts`
- **perf**: Parallelized `analyzer.ts` file processing with `PQueue`
- **perf**: Parallelized `todo-scanner.ts` file processing
- **chore**: Removed dead `withTimeout` utility

### Wave 1 — Foundation Fixes (`4196c59`)
- **fix**: `withWorktreeLock` now correctly releases locks on error
- **perf**: Bounded `Promise.all` with `PQueue` to prevent unbounded parallelism
- **perf**: Replaced `child_process.spawn` with `execa` for better error handling
- **feat**: SIGINT handler for graceful shutdown
- **fix**: Removed simulation fallback that silently skipped real execution
- **feat**: `defineConfig()` wrapper for type-safe config files
- **ux**: Getting Started help text for first-time users

