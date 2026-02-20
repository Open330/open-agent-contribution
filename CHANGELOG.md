# Changelog

All notable changes to OAC (Open Agent Contribution) are documented here.

## [Unreleased]

_No unreleased changes._

---

## [2026.2.5] — 2026-02-20

> **Note**: Versions `2026.3.x` and `2026.4.x` were published with an incorrect CalVer month.
> This release corrects the version to `2026.2.5` (year=2026, month=February, patch=5th iteration).

### Config Loader Fix (`fb57557`)
- **fix**: Config loader now matches `@open330/oac` import (previously only matched `@open330/oac-core`)

### OpenCode Provider Integration (`afdf725`)
- **feat**: OpenCode adapter (`src/execution/agents/opencode.adapter.ts`)
- **feat**: Adapter registry replacing hard-coded switch (`src/execution/agents/registry.ts`)
- **fix**: 7 pre-existing typecheck errors resolved (`doctor.ts`, `explain.ts`, `init.ts`, `task.ts`)

### Security & Quality Fixes (`55780e4`)
- **security**: Fixed shell injection in dashboard browser opener (replaced `exec` with `open` library)
- **security**: Sanitized branch names in `sandbox.ts` against path traversal
- **security**: Replaced `sh -c` shell redirect with `execa` piping in `github-auth.ts`
- **security**: Added `AbortSignal.timeout` to all GitHub API `fetch` calls
- **security**: SHA-pinned all CI/CD workflow actions
- **refactor**: Consolidated `truncate()` and `isRecord()` into `core/utils.ts`
- **refactor**: Unified error normalization into shared `normalizeError` module
- **refactor**: Extracted `AsyncEventQueue` into shared module for agent adapters
- **refactor**: Created scanner factory to eliminate construction duplication
- **chore**: Annotated all 10 empty catch blocks with `// best-effort` comments
- **ci**: Added `pnpm audit --prod` to CI pipeline

### Deploy Readiness (`91898c8`)
- **chore**: Added `LICENSE`, `CHANGELOG.md`, `docs/` to npm `files` array
- **chore**: Added `prepublishOnly` script (`pnpm build && pnpm test`)
- **chore**: Restored CI/CD workflows (SHA-pinned actions)
- **chore**: Lowered Node.js requirement from `>=24` to `>=20`
- **chore**: Fixed repository URL in `package.json`

### Wave 9 — Final P3/T3 Polish (`f8ff2ae`)
- **feat**: `oac init --minimal` for quick, non-interactive setup
- **feat**: `oac explain <task-id>` command — inspect why a task/epic was selected
- **feat**: Colored diff output in `--dry-run` mode (source files, complexity, scanner)
- **docs**: Comprehensive troubleshooting section in README
- **perf**: Streaming file reads in analyzer for large files (>1MB threshold)
- **perf**: Memory pressure monitoring — PQueue auto-throttles when heap usage exceeds 85%

### Wave 8 — Final UX Polish (`806a170`)
- **docs**: Auto-generated config reference from Zod schema (`docs/config-reference.md`)
- **docs**: Added CHANGELOG

### Maintenance
- **chore**: Temporarily removed CI/CD workflows during dev phase (`cb90214`)

---

## [2026.4.3] — 2026-02-18 _(deprecated — wrong CalVer month)_

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

