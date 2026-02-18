# Performance Review — Round 2 — OAC v2026.4.3

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-18  
**Scope**: Re-assessment after Wave 1–4 fixes (21 files changed, +766 −441 lines)  
**Previous Score**: 9.0 / 10

---

## Performance Review

### Summary
- **Risk Level**: WELL OPTIMIZED
- **Score**: 9.5 / 10 (+0.5)
- **Hot Path Issues**: 0 remaining
- **Estimated Impact**: All 3 round-1 findings resolved. No new performance concerns introduced.

### Round-1 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| P1 | Unbounded `Promise.all` in `estimateTaskMap` | MEDIUM | ✅ RESOLVED | Now uses `PQueue({ concurrency: 10 })` in `src/cli/helpers.ts`. Consistent with codebase pattern. Peak FD usage bounded from O(n) to O(10). |
| P2 | Sequential file reads in `readContributionLogs` | MEDIUM | ✅ RESOLVED | Replaced sequential `for` loop with `Promise.all(files.map(...))` in `src/dashboard/server.ts:70`. All log files read in parallel. For small JSON files this is the right approach — PQueue not needed here. |
| P3 | Missing `AbortSignal.timeout` on GitHub fetch | LOW | ✅ RESOLVED | `signal: AbortSignal.timeout(30_000)` added to `src/discovery/scanners/github-issues-scanner.ts`. Clean error on timeout instead of indefinite hang. |

### Performance Audit — Current State

**Concurrency patterns** — All bounded:
- `ExecutionEngine`: PQueue with configurable concurrency ✅
- `estimateTaskMap`: PQueue with concurrency 10 ✅ (was unbounded)
- `analyzeFile` in walker: PQueue with concurrency 50, adaptive under memory pressure ✅
- `readContributionLogs`: `Promise.all` for parallel reads ✅ (was sequential)
- `withWorktreeLock`: Properly serializes git operations ✅

**I/O patterns** — No sequential anti-patterns remaining:
- All `await`-in-loop patterns have been addressed
- `execa` with array args for all subprocess invocations ✅
- `atomicWriteJson` for safe persistence ✅
- Streaming reads for files >1MB in `analyzeFile` ✅

**Network patterns** — All timeouts present:
- GitHub API fetch: `AbortSignal.timeout(30_000)` ✅ (was missing)
- `gh auth token`: `timeout: 5_000` in `execFileSync` options ✅
- `gh auth status`: `timeout: 5_000` in `spawnSync` options ✅
- Agent execution: `DEFAULT_TIMEOUT_MS = 300_000` (5 min) ✅

**Memory patterns** — Well managed:
- `createMemoryMonitor` with PQueue throttling ✅
- `timer.unref()` — won't keep Node.js alive ✅
- `AsyncEventQueue` uses shift-based consumption (no unbounded growth) ✅
- Now in a single shared location (`shared.ts`) — no duplication risk ✅

### New Code Performance Assessment

The 3 new modules introduce no performance concerns:

1. **`normalize-error.ts`** — Called only on error paths (cold). 6 regex tests on short error messages. Negligible.
2. **`shared.ts`** — `AsyncEventQueue` is unchanged from the original implementation. No regression.
3. **`scanner-factory.ts`** — Called once per run to construct scanners. Array operations on ≤4 elements. Negligible.

### Remaining Observations

#### [INFO] O1: Dashboard log reads are unbounded

- **File**: `src/dashboard/server.ts:55` (`readContributionLogs`)
- **Description**: Reads all `.json` files in the contributions directory. For a long-running project with hundreds of past runs, this could accumulate. Currently mitigated by the fact that each file is small (1-5KB).
- **Impact**: Negligible for typical use (<100 runs). Would benefit from pagination for power users.
- **Recommendation**: Add optional `?limit=N` query param to `/api/v1/logs` endpoint when usage warrants it. Not actionable now.

### Positive Patterns

1. **PQueue is the universal concurrency pattern** — Every bounded-concurrency need in the codebase uses PQueue. No ad-hoc semaphores, no `Promise.all` with manual chunking. This consistency makes the codebase predictable.
2. **Timeout discipline** — Every external I/O call (subprocess, fetch, auth check) now has an explicit timeout. This is rare and commendable for a CLI tool.
3. **Memory pressure monitoring with hysteresis** — The edge-triggered memory monitor (85% threshold, halve on pressure, double on relief) is sophisticated and correct. `unref()` on the timer is the right call.
4. **Atomic writes for all persistence** — No risk of corrupted JSON files on crash or power loss.
5. **Streaming for large file analysis** — The 1MB threshold + skip-generated-files heuristic is well-tuned.

### Recommendations

No actionable performance recommendations remain. The codebase is well-optimized for a CLI tool of this scope. Future focus should be on profiling real-world usage (e.g., `oac run` on a 500-file monorepo) rather than code-level optimizations.

