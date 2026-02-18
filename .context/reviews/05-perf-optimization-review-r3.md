# Performance Optimization Review — Round 3 — OAC v2026.4.2

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Re-evaluation after Wave 4 (timeout, PQueue unification, shell completion, retry-failed)  
**Previous review**: `03-perf-optimization-review-r2.md` (Score: 7/10)

---

## 1. Executive Summary

Wave 4 targeted the three specific concerns that prevented a higher score in Round 2: missing timeout on external processes, dual concurrency primitives, and pipeline resilience. All three are resolved.

The custom `runWithConcurrency` function is completely eliminated from both `run.ts` and `dashboard/pipeline.ts`, replaced by PQueue throughout. PR creation now has a 2-minute timeout (`PR_CREATION_TIMEOUT_MS = 120_000`) on both `git push` and `gh pr create`. The `--retry-failed` flag adds pipeline resilience without re-running the entire discovery/estimation pipeline. Shell completion (`oac completion bash/zsh/fish`) is a zero-runtime-cost feature that generates static scripts.

What remains: `run.ts` grew from 1,561 to 1,691 lines (the retry pipeline added ~130 lines). The monolith concern is now more pressing than before — but the added functionality (retry, timeout) is genuinely valuable and correctly placed. The file needs decomposition, but not because the new code is wrong — because the file was already too large.

**Efficiency score: 8/10** — Up from 7/10. The concurrency model is now uniform (PQueue everywhere), external process calls have timeout protection, and the tool can recover from partial failures without wasting tokens on re-execution.

---

## 2. Issue-by-Issue Resolution Status

### Tier 0 — Blocking (both RESOLVED ✅ — unchanged from R2)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T0-1 | `withWorktreeLock` double-execution | ✅ Fixed (Wave 1) | Stable |
| T0-2 | Unbounded `Promise.all` in estimator | ✅ Fixed (Wave 1) | Stable |

### Tier 1 — High Impact (3/4 RESOLVED — unchanged)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T1-1 | Sequential file analysis | ✅ Fixed (Wave 2) | Stable |
| T1-2 | Epic pipeline sequential | ✅ Fixed (Wave 3) | Now uses PQueue instead of `runWithConcurrency` (Wave 4) |
| T1-3 | Duplicated helpers | ✅ Fixed (Wave 2) | Stable |
| T1-4 | `run.ts` monolith | ⚠️ Worse | Grew from 1,561 → 1,691 lines. Retry pipeline added ~130 lines of well-structured code, but the file needs decomposition |

### Tier 2 — Efficiency (ALL RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T2-1 | No timeout on external processes | ✅ Fixed (Wave 4) | `PR_CREATION_TIMEOUT_MS = 120_000` applied to `git push` and `gh pr create`. Agent adapters already had `timeout: params.timeoutMs` — investigation confirmed this was only missing on PR creation |
| T2-2 | Dead `withTimeout` function | ✅ Fixed (Wave 2) | Stable |
| T2-3 | `spawn` → `execa` in doctor.ts | ✅ Fixed (Wave 1) | Stable |
| T2-4 | SIGINT handler in status watch | ✅ Fixed (Wave 1) | Stable |
| T2-5 | Parallel directory traversal | ✅ Fixed (Wave 2) | Stable |
| T2-6 | Replace `runWithConcurrency` with PQueue | ✅ Fixed (Wave 4) | Custom function deleted from both `run.ts` and `pipeline.ts`. All 4 call sites migrated to `new PQueue({ concurrency })` + `Promise.all(items.map(...))` pattern |

### Tier 3 — Polish (0/3 RESOLVED — unchanged)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ❌ Open | Acceptable for typical source files |
| T3-2 | Resettable token counters | ❌ Open | Module-level singletons — low impact |
| T3-4 | Memory pressure monitoring | ❌ Open | Low priority for CLI tool |

---

## 3. New Observations (Post-Wave 4)

### Positive Changes

1. **PQueue usage is now uniform**: Every bounded-concurrency operation in the codebase uses PQueue — estimator (50), analyzer (50), epic execution (configurable), task execution (configurable), PR creation (configurable). No more cognitive overhead from two primitives. The `as Promise<T>` type assertion pattern is consistent across all call sites.

2. **PR creation timeout is correctly scoped**: The 2-minute timeout on `git push` and `gh pr create` is appropriate — these are network operations that should never take > 2 minutes under normal conditions. The constant `PR_CREATION_TIMEOUT_MS` is clearly named and easy to adjust.

3. **Agent adapter timeout was already correct**: The investigation revealed that both `claude-adapter.ts` and `codex-adapter.ts` already pass `timeout: params.timeoutMs` to their `execa` calls. The Round 2 concern about "no timeout on agent execution" was a false positive for the adapters — only `createPullRequest` was missing timeout protection.

4. **Retry pipeline is well-structured**: `readMostRecentContributionLog` → `taskFromContributionEntry` → `runRetryPipeline` is a clean three-function decomposition. The contribution log reading is defensive (tries files in reverse chronological order, skips parse failures). Task reconstruction assigns `priority: 100` to ensure retried tasks are selected first within budget.

5. **Shell completion has zero runtime cost**: The `completion` command generates static shell scripts — no runtime overhead, no additional dependencies. The generated scripts cover all 10 subcommands and their options.

### Remaining Concerns

1. **`run.ts` monolith — now critical**: At 1,691 lines, this file contains: pipeline orchestration, epic execution, task execution, PR creation with timeout, retry pipeline with contribution log parsing, formatting utilities, and summary rendering. The retry feature is the right functionality but adds weight to an already overloaded file. **This is now the single most important refactoring target.** Recommended decomposition:
   - `src/cli/commands/run/pipeline.ts` — main orchestration (runPipeline, config resolution)
   - `src/cli/commands/run/epic.ts` — epic discovery, planning, execution
   - `src/cli/commands/run/task.ts` — task discovery, planning, execution
   - `src/cli/commands/run/pr.ts` — PR creation, branch management
   - `src/cli/commands/run/retry.ts` — retry pipeline, contribution log reading
   - `src/cli/commands/run/format.ts` — formatting, summary rendering
   - `src/cli/commands/run/index.ts` — command definition, re-exports

---

## 4. Revised Prioritized Optimizations

### Tier 1 — High Impact (1 remaining)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T1-4 | Decompose `run.ts` into modules | `src/cli/commands/run.ts` → `run/` directory | 4-6 hours | Maintainability — file is now 1,691 lines and growing |

### Tier 3 — Polish (unchanged)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T3-1 | Streaming file reads in analyzer | `analyzer.ts` | 2-3 hours | Minor heap improvement |
| T3-2 | Resettable token counters | `estimator.ts` | 30 min | Correctness in long-lived processes |
| T3-4 | Memory pressure monitoring | General | 3-4 hours | Defense against OOM on constrained machines |

---

## 5. Final Verdict

**Score: 8/10** — Up from 7/10.

The concurrency model is now clean and uniform. Every external process call has timeout protection. The tool can recover from partial failures without wasting tokens. The PQueue migration eliminated the last primitive duplication.

**What changed my assessment**:
- Uniform PQueue usage eliminates cognitive overhead for contributors
- PR creation timeout prevents indefinite pipeline hangs in CI environments
- Retry-failed feature means partial failures don't waste the entire token budget
- Agent adapter timeout investigation confirmed the adapters were already correct — good engineering

**What prevents a higher score**:
- `run.ts` at 1,691 lines is the single remaining architectural debt item. It's functional, well-organized internally, but too large for one file. Every new feature (retry, timeout) adds lines to an already overloaded module.
- Tier 3 items (streaming reads, resettable counters, memory monitoring) are genuine improvements but low priority for a CLI tool

**Path forward**: Decompose `run.ts` into a `run/` directory with focused modules. This is the only remaining structural issue. After that decomposition, the codebase is in solid shape — clean concurrency, proper error handling, timeout protection, and recovery from partial failures. The Tier 3 items can be addressed opportunistically.

