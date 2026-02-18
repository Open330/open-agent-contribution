# Performance Optimization Review — Round 2 — OAC v2026.4.2

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Full codebase re-evaluation after Waves 1–3  
**Previous review**: `01-perf-optimization-review.md` (Score: 4/10)

---

## 1. Executive Summary

Three implementation waves have addressed the majority of Tier 0 and Tier 1 issues from the initial review. The `withWorktreeLock` double-execution bug is fixed. The unbounded `Promise.all` in the estimator is replaced with bounded PQueue. The sequential file analysis bottleneck is gone — the analyzer now uses PQueue with concurrency 50. The epic pipeline is parallelized via `runWithConcurrency`. Eleven duplicated helpers are extracted to a shared module. Dead code (`withTimeout`, `simulateExecution`) is removed. `doctor.ts` migrated from raw `spawn` to `execa` with a 30-second timeout. The status watch mode has a proper SIGINT handler.

What remains: `run.ts` is still a 1,561-line monolith. External process calls (agent CLIs, `gh pr create`) still lack timeout protection. The custom `runWithConcurrency` still exists alongside PQueue rather than using PQueue uniformly. Token counters remain non-resettable. These are real issues, but they're Tier 1–3 concerns — the crash vectors and critical bottlenecks are resolved.

**Efficiency score: 7/10** — Up from 4/10. The critical bugs are fixed, the major bottlenecks are eliminated, and the codebase is measurably cleaner. Remaining issues are architectural debt and polish, not correctness or scaling failures.

---

## 2. Issue-by-Issue Resolution Status

### Tier 0 — Blocking (both RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T0-1 | `withWorktreeLock` double-execution | ✅ Fixed | Now uses `.catch(() => {}).then(fn)` — correct error recovery before next operation |
| T0-2 | Unbounded `Promise.all` in estimator | ✅ Fixed | Replaced with `PQueue({ concurrency: 50 })` for file reads, `PQueue({ concurrency: 10 })` for epic estimation |

### Tier 1 — High Impact (3/4 RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T1-1 | Sequential file analysis | ✅ Fixed | `analyzer.ts` now uses `PQueue({ concurrency: 50 })` for file analysis loop |
| T1-2 | Epic pipeline sequential | ✅ Fixed | Epics now execute through `runWithConcurrency` with configurable concurrency |
| T1-3 | Duplicated helpers | ✅ Fixed | 11 functions extracted to `src/cli/helpers.ts`, all 9 command files updated |
| T1-4 | `run.ts` monolith (1,680 lines) | ⚠️ Partially addressed | Down from 1,680 to 1,561 lines (helper extraction, dead code removal). Still too large — but the reduction is meaningful and the extracted helpers are cleanly factored |

### Tier 2 — Efficiency (3/5 RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T2-1 | No timeout on external processes | ❌ Open | Agent CLIs and `gh pr create` still lack timeout protection. `doctor.ts` now has 30s timeout on its checks, but the execution pipeline does not |
| T2-2 | Dead `withTimeout` function | ✅ Fixed | Removed entirely from `run.ts` |
| T2-3 | `spawn` → `execa` in doctor.ts | ✅ Fixed | Now uses `execa` with `reject: false, timeout: 30_000` — consistent with codebase |
| T2-4 | SIGINT handler in status watch | ✅ Fixed | `process.on("SIGINT", ...)` with `clearInterval` and clean exit |
| T2-5 | Parallel directory traversal | ✅ Fixed | `todo-scanner.ts` subdirectories processed with `Promise.all` |

### Tier 3 — Polish (0/4 RESOLVED)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ❌ Open | Still uses `readFile` for full content — acceptable for typical source files |
| T3-2 | Resettable token counters | ❌ Open | Module-level singletons unchanged |
| T3-3 | Use PQueue instead of `runWithConcurrency` | ❌ Open | Custom worker pool still exists alongside PQueue |
| T3-4 | Memory pressure monitoring | ❌ Open | Low priority for CLI tool |

---

## 3. New Observations (Post-Waves 1–3)

### Positive Changes

1. **`suppressOutput` pattern in run.ts**: The `--quiet` flag implementation introduces `ctx.suppressOutput = ctx.outputJson || ctx.quiet`, which correctly gates interactive output while preserving JSON output branches. Clean separation of concerns.

2. **Failed task/epic surfacing**: Both `printRunSummary` and `printEpicSummary` now show failed item details (title + truncated error) without requiring `--verbose`. Good for debugging without noise.

3. **PQueue usage is idiomatic**: The bounded concurrency in `estimator.ts` and `analyzer.ts` follows the correct pattern — `queue.add(() => ...)` with type assertions for the void return. No abuse of the API.

4. **Helper module is well-organized**: `src/cli/helpers.ts` at 150 lines is clean — section comments, proper re-exports, consistent patterns. This is how shared utilities should look.

### Remaining Concerns

1. **`run.ts` is still the monolith**: At 1,561 lines, it contains pipeline orchestration, epic execution, task execution, PR creation, formatting utilities, the `runWithConcurrency` worker pool, and summary rendering. The helper extraction reduced it by ~120 lines, but the core problem — too many responsibilities in one file — remains. This is now the **single largest maintenance risk** in the codebase.

2. **No timeout on agent execution**: When Claude Code or Codex CLI hangs (network issue, auth prompt, model overload), the entire pipeline blocks. The `execa` calls in agent adapters don't specify `timeout`. For a tool that users run unattended, this is a real-world failure mode.

3. **`runWithConcurrency` duplication of PQueue**: The custom worker pool in `run.ts` (lines ~1517-1561) uses a shared `nextIndex` counter pattern. It's correct in single-threaded JS, but PQueue already provides this with better error handling, event hooks, and pause/resume. Having both is cognitive overhead for future contributors.

---

## 4. Performance Scaling Projection (Revised)

For a repo with 10,000 source files after Waves 1–3:

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| File analysis (analyzer) | ~10,000 sequential reads | 50 concurrent reads via PQueue | **~20-50× faster** |
| Token estimation | Unbounded `Promise.all` (EMFILE crash at ~250 files) | PQueue(50) bounded | **No longer crashes** |
| Epic execution (5 epics) | Sequential: sum of all epic times | Concurrent with configurable limit | **~2-5× faster** |
| Directory traversal | Sequential `readdir` | `Promise.all` for subdirs | **~2-5× faster** on deep trees |
| Doctor checks | Raw `spawn`, no timeout | `execa` with 30s timeout | **Won't hang** |

The scaling limit has shifted from ~250 files (EMFILE crash) and ~5,000 files (sequential bottleneck) to the point where agent execution time dominates — which is the correct bottleneck for a tool that orchestrates AI agents.

---

## 5. Revised Prioritized Optimizations

### Tier 1 — High Impact (Remaining)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T1-4 | Decompose `run.ts` | `src/cli/commands/run.ts` | 4-6 hours | Maintainability — prevents the monolith from growing further |

### Tier 2 — Efficiency (Remaining)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T2-1 | Add timeout to agent execution | Agent adapters + `run.ts` PR creation | 1-2 hours | Prevents pipeline hangs on network issues |
| T2-6 | Replace `runWithConcurrency` with PQueue | `run.ts` | 1 hour | Eliminates duplicate concurrency primitive |

### Tier 3 — Polish (Unchanged)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T3-1 | Streaming file reads in analyzer | `analyzer.ts` | 2-3 hours | Minor heap improvement |
| T3-2 | Resettable token counters | `estimator.ts` | 30 min | Correctness in long-lived processes |
| T3-4 | Memory pressure monitoring | General | 3-4 hours | Defense against OOM on constrained machines |

---

## 6. Final Verdict

**Score: 7/10** — Up from 4/10.

The codebase has gone from "working prototype with prototype-level performance" to "production-viable CLI with specific architectural debt." Every Tier 0 bug is fixed. Most Tier 1 bottlenecks are eliminated. The concurrency model is now reasonable — PQueue for bounded I/O, `runWithConcurrency` for pipeline orchestration, proper SIGINT handling for watch mode.

**What changed my assessment**:
- The `withWorktreeLock` fix eliminates the only data corruption vector
- Bounded concurrency in estimator eliminates the EMFILE crash
- Parallelized analyzer eliminates the single largest bottleneck
- Parallelized epic pipeline means total run time is `max(epics)` not `sum(epics)`
- Helper extraction makes the codebase maintainable for contributors

**What prevents a higher score**:
- `run.ts` at 1,561 lines is still too large for one file — it needs decomposition into pipeline, epic, task, PR, and formatting modules
- No timeout on agent execution or PR creation means the pipeline can hang indefinitely on network issues
- Two concurrency primitives (PQueue + custom `runWithConcurrency`) where one would suffice

**Path forward**: The remaining work is architectural cleanup (run.ts decomposition) and defensive engineering (timeouts). Neither is urgent — the tool works correctly at scale now. But both will become pain points as features are added. Decompose `run.ts` before the next wave of features, and add timeouts before deploying to unattended CI environments.

