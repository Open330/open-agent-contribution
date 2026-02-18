# Performance Optimization Review — Round 8 — OAC v2026.4.2

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Re-evaluation after Wave 9 (final P3/T3 polish)  
**Previous review**: `13-perf-optimization-review-r7.md` (Score: 9/10)

---

## 1. Executive Summary

Wave 9 delivered 6 items: 4 UX features (P3-2, P3-3, P3-4, P3-6) and **2 performance items** (T3-1, T3-4). Both remaining Tier 3 performance issues are now resolved.

**Efficiency score: 9.5/10** — Up from 9/10. T3-1 and T3-4 close the last open items.

---

## 2. Wave 9 Changes — Performance Impact Assessment

| File | Change | Performance Impact |
|------|--------|--------------------|
| `src/discovery/analyzer.ts` | T3-1: Streaming file reads for files >1MB | ✅ Positive — large files no longer allocate multi-MB strings on V8 heap |
| `src/discovery/analyzer.ts` | T3-4: Memory-aware PQueue concurrency | ✅ Positive — concurrency halves when heap >85%, restores on relief |
| `src/core/memory.ts` | New `createMemoryMonitor` + `getMemorySnapshot` | Negligible — periodic `process.memoryUsage()` calls (~µs) |
| `src/cli/commands/init.ts` | P3-2: `--minimal` flag | None — CLI ergonomics only |
| `src/cli/commands/run/task.ts` | P3-3: Colored dry-run output | None — output formatting only |
| `src/cli/commands/explain.ts` | P3-4: New explain command | None — reads persisted JSON, no heavy compute |
| `README.md` | P3-6: Troubleshooting section | None — documentation |

### T3-1: Streaming File Reads — Analysis

The approach is pragmatic:
- **Files ≤ 1MB**: Keep existing `readFile` → `split("\n")` path. Fast, simple, no change.
- **Files > 1MB**: `stat()` first, then `createReadStream` → `readline` for LOC counting. Export/import extraction is skipped for these files (correctly — multi-MB source files are almost always generated/vendored).

This is the right tradeoff. The 1MB threshold is sensible — it's well above typical source files (5-50KB) but catches generated bundles and vendored code that would otherwise stress the heap.

### T3-4: Memory Pressure Monitoring — Analysis

The implementation is clean:
- `createMemoryMonitor` polls `process.memoryUsage()` every 3 seconds (unref'd timer — won't keep process alive).
- When heap usage exceeds 85%, PQueue concurrency is halved (floor: 4). When it drops back, concurrency doubles (ceiling: 50).
- The hysteresis between `onPressure` and `onRelief` prevents flip-flopping.
- The monitor is stopped when the analysis queue drains (`memoryMonitor.stop()`).

One minor observation: the monitor polls at a fixed interval rather than checking after each task completion. This means there's up to a 3-second delay before concurrency adjusts. In practice this is fine — the PQueue already has tasks in flight, and the gradual reduction is gentler than an immediate halt.

---

## 3. Issue-by-Issue Resolution Status

### Tier 0–2 — ALL RESOLVED ✅ (stable since R1–R4)

No changes. All 12 items remain resolved and stable.

### Tier 3 — Polish (ALL RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ✅ Fixed (Wave 9) | readline stream for >1MB files |
| T3-2 | Resettable token counters | ✅ Fixed (Wave 7) | Stable |
| T3-4 | Memory pressure monitoring | ✅ Fixed (Wave 9) | Adaptive PQueue concurrency |

---

## 4. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 4/10 | Initial audit — blocking bugs, no concurrency control |
| R2 | 7/10 | Wave 1-2 — core fixes, PQueue, parallel analysis |
| R3 | 8/10 | Wave 3-4 — timeout protection, uniform concurrency |
| R4 | 9/10 | Wave 5 — run.ts monolith decomposed |
| R5 | 9/10 | Wave 6 — UX-only, no perf delta |
| R6 | 9/10 | Wave 7 — T3-2 resolved, progress callbacks |
| R7 | 9/10 | Wave 8 — docs only, no runtime changes |
| **R8** | **9.5/10** | Wave 9 — T3-1, T3-4 resolved, all perf items closed |

---

## 5. Final Verdict

**Score: 9.5/10** — Up from 9/10.

All identified performance issues across Tiers 0–3 are now resolved. The 0.5 held back is for potential future optimization in daemon/long-running mode (connection pooling, incremental analysis, per-repo memory isolation) — none of which apply to the current CLI architecture.

**For a CLI tool that runs as a short-lived process, the performance story is complete.** Every PQueue is bounded, large files are streamed, memory pressure is monitored, timeouts are enforced, and concurrency is adaptive. This is production-grade.

**Recommendation**: Performance work is done. All items resolved. Ship it.

