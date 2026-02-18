# Performance Optimization Review — Round 6 — OAC v2026.5.0

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Re-evaluation after Wave 7 (quick wins: `oac r` alias, exit codes, resettable counters, progress %)  
**Previous review**: `09-perf-optimization-review-r5.md` (Score: 9/10)

---

## 1. Executive Summary

Wave 7 touched runtime code in four areas: (1) exit code propagation, (2) resettable token counter singletons, (3) progress percentage callbacks in estimation/execution spinners, and (4) a one-line `.alias("r")` on the run command.

Items (1) and (4) are zero-impact — exit codes add a single integer comparison after the pipeline finishes, and aliases are resolved once during CLI parse. Item (3) adds lightweight callback invocations during estimation and execution loops — one call per task/epic, doing integer arithmetic and string assignment on an `ora` spinner. Trivial overhead.

Item (2) — **T3-2 resolved** — adds `reset()` methods to `ClaudeTokenCounter` and `CodexTokenCounter`, plus a `resetCounters()` export. This addresses the correctness issue of encoder singletons surviving across logical runs in long-lived processes. The `encoder.free()` call properly releases tiktoken's WASM resources.

**Efficiency score: 9/10** — Unchanged from Round 5. T3-2 was a correctness fix, not a throughput improvement. The remaining T3 items (streaming reads, memory monitoring) are the same low-priority polish items from previous rounds.

---

## 2. Wave 7 Changes — Performance Impact Assessment

| File | Change | Performance Impact |
|------|--------|--------------------|
| `run/index.ts` | `.alias("r")` + exit code docs in help text | None — parsed once at CLI init |
| `run/types.ts` | Exit code constants, `ConfigError` class, `resolveExitCode()` | None — called once after pipeline finishes |
| `run/pipeline.ts` | `process.exitCode = resolveExitCode(results)` after each path | None — one array scan at end |
| `run/epic.ts` | Return `TaskRunResult[]`, progress spinner updates during estimation/execution | Negligible — one string assignment per epic |
| `run/task.ts` | Progress callback in `estimateTaskMap`, percentage in execution spinner | Negligible — one callback per task during estimation |
| `run/retry.ts` | Return `TaskRunResult[]` | None — type change only |
| `helpers.ts` | `estimateTaskMap` accepts optional `onProgress` callback | Negligible — optional callback overhead |
| `budget/estimator.ts` | `resetCounters()` export, `TokenCounter.reset?()` | None at runtime — called explicitly when needed |
| `budget/providers/claude-counter.ts` | `reset()` method — `encoder.free()` + nullify | Frees WASM memory when called |
| `budget/providers/codex-counter.ts` | `reset()` method — `encoder.free()` + nullify | Same |
| `cli/index.ts` | `ConfigError` detection in catch block | None — one `instanceof` check on error path |

**Verdict**: No hot-path changes. Progress callbacks are O(1) per task/epic. Exit code computation is a single pass over results. All overhead is below measurement noise.

---

## 3. Issue-by-Issue Resolution Status

### Tier 0 — Blocking (ALL RESOLVED ✅ — stable since R1)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T0-1 | `withWorktreeLock` double-execution | ✅ Fixed (Wave 1) | Stable |
| T0-2 | Unbounded `Promise.all` in estimator | ✅ Fixed (Wave 1) | Stable |

### Tier 1 — High Impact (ALL RESOLVED ✅ — stable since R4)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T1-1 | Sequential file analysis | ✅ Fixed (Wave 2) | Stable |
| T1-2 | Epic pipeline sequential | ✅ Fixed (Wave 3) | Stable |
| T1-3 | Duplicated helpers | ✅ Fixed (Wave 2) | Stable |
| T1-4 | `run.ts` monolith | ✅ Fixed (Wave 5) | Stable |

### Tier 2 — Efficiency (ALL RESOLVED ✅ — stable since R3/R4)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T2-1 | No timeout on PR creation | ✅ Fixed (Wave 4) | Stable |
| T2-2 | Dead `withTimeout` function | ✅ Fixed (Wave 2) | Stable |
| T2-3 | `spawn` → `execa` in doctor.ts | ✅ Fixed (Wave 1) | Stable |
| T2-4 | SIGINT handler in status watch | ✅ Fixed (Wave 1) | Stable |
| T2-5 | Parallel directory traversal | ✅ Fixed (Wave 2) | Stable |
| T2-6 | `runWithConcurrency` → PQueue | ✅ Fixed (Wave 4) | Stable |

### Tier 3 — Polish (1/3 RESOLVED — T3-2 fixed in Wave 7)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ❌ Open | Low priority — typical source files fit in memory |
| T3-2 | Resettable token counters | ✅ Fixed (Wave 7) | `reset()` on both counters, `resetCounters()` export, `encoder.free()` releases WASM memory |
| T3-4 | Memory pressure monitoring | ❌ Open | Low priority for CLI with bounded concurrency |

---

## 4. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 4/10 | Initial audit — blocking bugs, no concurrency control |
| R2 | 7/10 | Wave 1-2 — core fixes, PQueue, parallel analysis |
| R3 | 8/10 | Wave 3-4 — timeout protection, uniform concurrency |
| R4 | 9/10 | Wave 5 — run.ts monolith decomposed |
| R5 | 9/10 | Wave 6 — UX-only, no perf delta |
| **R6** | **9/10** | Wave 7 — T3-2 resolved, progress callbacks (negligible overhead) |

---

## 5. Remaining Optimizations

Only 2 Tier 3 items remain:

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T3-1 | Streaming file reads | `analyzer.ts` | 2-3 hours | Minor heap reduction for very large files |
| T3-4 | Memory pressure monitoring | General | 3-4 hours | OOM defense on constrained machines |

---

## 6. Final Verdict

**Score: 9/10** — Unchanged.

Wave 7 resolved T3-2 (resettable token counters), which was a real correctness issue for long-lived processes. The remaining items (T3-1 streaming reads, T3-4 memory monitoring) are defensive measures for edge cases that don't affect typical CLI usage.

**What prevents a 10/10**: T3-1 and T3-4. Both would matter in a daemon mode or processing repositories with 100K+ files. For OAC's current CLI use case, 9/10 represents an effectively complete performance architecture.

**Recommendation**: Performance work is complete for the CLI use case. If OAC adds a daemon/server mode or watch-and-rerun capability, T3-1 and T3-4 become relevant. Until then, invest in features and UX.

