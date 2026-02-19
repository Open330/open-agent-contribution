# Performance Review — Round 4 — OAC v2026.4.3

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after utility consolidation and CI hardening (commit `55780e4`). 17 files changed — import refactoring and comment additions. No algorithmic or I/O pattern changes.  
**Previous Score**: 9.5 / 10

---

## Performance Review

### Summary
- **Risk Level**: WELL OPTIMIZED
- **Score**: 9.5 / 10 (unchanged)
- **Hot Path Issues**: 0
- **Estimated Impact**: Zero runtime performance change. All modifications are import path changes and comment additions — no algorithmic, I/O, or concurrency changes.

### Round-3 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| O1 | Dashboard log reads unbounded | INFO | ⚠️ OPEN | No change. Still reads all `.json` files. Negligible for <100 runs. |
| O2 | CI build caching | INFO | ⚠️ OPEN | No change. Each CI job builds independently. Negligible at current scale. |

### Performance Audit — Current State

This round's changes (utility consolidation, catch block annotations, CI SHA-pinning) are **code organization only** and have **zero impact on runtime performance**. The full performance audit from round-2 stands unchanged:

**Concurrency patterns** — All bounded:
- `ExecutionEngine`: PQueue with configurable concurrency ✅
- `estimateTaskMap`: PQueue with concurrency 10 ✅
- `analyzeFile` walker: PQueue with concurrency 50, adaptive under memory pressure ✅
- `readContributionLogs`: `Promise.all` for parallel reads ✅
- `withWorktreeLock`: Properly serializes git operations ✅

**I/O patterns** — No sequential anti-patterns:
- All `await`-in-loop patterns eliminated ✅
- `execa` with array args for all subprocess invocations ✅
- `atomicWriteJson` for safe persistence ✅
- Streaming reads for files >1MB in `analyzeFile` ✅

**Network patterns** — All timeouts present:
- GitHub API fetch: `AbortSignal.timeout(30_000)` ✅
- `gh auth token`: `timeout: 5_000` ✅
- `gh auth status`: `timeout: 5_000` ✅
- Agent execution: `DEFAULT_TIMEOUT_MS = 300_000` (5 min) ✅

**Memory patterns** — Well managed:
- `createMemoryMonitor` with PQueue throttling and hysteresis ✅
- `timer.unref()` — won't keep Node.js alive ✅
- `AsyncEventQueue` shift-based consumption ✅

### Module Load Performance Note

The consolidation of `truncate` and `isRecord` into `core/utils.ts` reduces the number of unique function definitions loaded at module initialization. While this has negligible impact on a CLI tool (cold start once per invocation), it demonstrates good practice for tree-shaking and module resolution:

- **Before**: 4 copies of `truncate` loaded via 4 different module scopes
- **After**: 1 copy loaded once, imported via module cache

Net effect on cold start: ~0ms (V8 module cache is sub-millisecond for re-exports). But it establishes the right pattern if this codebase ever becomes a library consumed by others.

### Remaining Observations

#### [INFO] O1 (carried over): Dashboard log reads unbounded

- **File**: `src/dashboard/server.ts:55`
- **Description**: Reads all `.json` files in contributions directory without pagination.
- **Impact**: Negligible for <100 runs. Would need attention at 1000+ runs.
- **Recommendation**: Add `?limit=N` when usage warrants.

### Positive Patterns

1. **PQueue universal concurrency** — Every bounded-concurrency need uses PQueue. Consistent and predictable.
2. **Timeout discipline** — Every external I/O call has an explicit timeout.
3. **Memory pressure monitoring** — Edge-triggered with hysteresis. Sophisticated and correct.
4. **Module deduplication** — Single definitions for shared primitives eliminates redundant parsing overhead.
5. **`pnpm audit` in CI** — Catches dependency regressions that could introduce performance-affecting CVEs (e.g., ReDoS in regex-based deps).

### Recommendations

No new performance recommendations. The codebase is well-optimized for a CLI tool. The ceiling for this score (9.5) is structural — reaching 10/10 would require:
1. Real-world profiling data from `oac run` on large repos (500+ files)
2. Dashboard pagination for high-usage scenarios
3. CI build caching (only relevant when build time exceeds 30s)

None of these are actionable at current scale.

