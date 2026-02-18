# Performance Optimization Review — Round 5 — OAC v2026.5.0

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Re-evaluation after Wave 6 (UX: single-command pipeline + scan/analyze clarification)  
**Previous review**: `07-perf-optimization-review-r4.md` (Score: 9/10)

---

## 1. Executive Summary

Wave 6 was entirely UX-focused — no runtime behavior changes, no concurrency changes, no new I/O paths. The edits touched five files across help text, descriptions, and one error message string in `resolveRepoInput`. Zero impact on hot paths, memory, or concurrency.

**Efficiency score: 9/10** — Unchanged from Round 4. No regressions, no new performance-relevant code to evaluate.

---

## 2. Wave 6 Changes — Performance Impact Assessment

| File | Change | Performance Impact |
|------|--------|--------------------|
| `helpers.ts` | `resolveRepoInput` error message expanded to multi-line with quick-start guidance | None — error path only, never on hot path |
| `run/index.ts` | Command description + `addHelpText` expanded | None — parsed once at CLI init, not during pipeline execution |
| `scan.ts` | Description updated, cross-reference help text added | None — same as above |
| `analyze.ts` | Description updated, cross-reference help text added | None — same as above |
| `init.ts` | Final success message updated | None — one-time output after init |

**Verdict**: These are pure string literal changes in CLI command definitions. They execute once during `commander.js` program construction, before any pipeline runs. No measurable performance delta.

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

### Tier 3 — Polish (0/3 RESOLVED — unchanged)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ❌ Open | Low priority — typical source files fit in memory |
| T3-2 | Resettable token counters | ❌ Open | Correctness in long-lived processes only |
| T3-4 | Memory pressure monitoring | ❌ Open | Low priority for CLI with bounded concurrency |

---

## 4. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 4/10 | Initial audit — blocking bugs, no concurrency control |
| R2 | 7/10 | Wave 1-2 — core fixes, PQueue, parallel analysis |
| R3 | 8/10 | Wave 3-4 — timeout protection, uniform concurrency |
| R4 | 9/10 | Wave 5 — run.ts monolith decomposed |
| **R5** | **9/10** | Wave 6 — UX-only, no perf delta |

---

## 5. Remaining Optimizations

Only Tier 3 polish items remain. All are low-priority for a CLI tool:

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T3-1 | Streaming file reads | `analyzer.ts` | 2-3 hours | Minor heap reduction for very large files |
| T3-2 | Resettable token counters | `estimator.ts` | 30 min | Correctness in long-running processes |
| T3-4 | Memory pressure monitoring | General | 3-4 hours | OOM defense on constrained machines |

---

## 6. Final Verdict

**Score: 9/10** — Unchanged.

Wave 6 had zero performance impact by design — it was a UX clarification wave. The codebase's performance architecture remains in excellent shape: uniform PQueue concurrency, timeout protection on all external calls, clean module boundaries, no unbounded parallelism.

**What prevents a 10/10**: The same Tier 3 items from Round 4. These are genuine improvements but impractical priorities for a CLI tool that processes typical-sized source repositories. They would matter in a long-running daemon or a tool processing repositories with 100K+ files — neither of which is OAC's current use case.

**Recommendation**: Performance work is effectively complete. Future waves should focus on feature development and UX — the performance foundations are solid.

