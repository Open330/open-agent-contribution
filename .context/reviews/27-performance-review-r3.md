# Performance Review — Round 3 — OAC v2026.4.3

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after deploy readiness fixes (commit `91898c8`). Infrastructure changes only — no source code modifications.  
**Previous Score**: 9.5 / 10

---

## Performance Review

### Summary
- **Risk Level**: WELL OPTIMIZED
- **Score**: 9.5 / 10 (unchanged)
- **Hot Path Issues**: 0
- **Estimated Impact**: No performance-relevant changes in this round. All source code is identical to round-2.

### Round-2 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| O1 | Dashboard log reads unbounded | INFO | ⚠️ OPEN | No change. `readContributionLogs` still reads all `.json` files. Negligible for <100 runs. Add `?limit=N` when usage warrants. |

### Performance Audit — Current State

This round's changes (CI/CD, package.json, README) are infrastructure-only and have **zero impact on runtime performance**. The full performance audit from round-2 stands:

**Concurrency patterns** — All bounded:
- `ExecutionEngine`: PQueue with configurable concurrency ✅
- `estimateTaskMap`: PQueue with concurrency 10 ✅
- `analyzeFile` in walker: PQueue with concurrency 50, adaptive under memory pressure ✅
- `readContributionLogs`: `Promise.all` for parallel reads ✅
- `withWorktreeLock`: Properly serializes git operations ✅

**I/O patterns** — No sequential anti-patterns:
- All `await`-in-loop patterns addressed ✅
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

### CI/CD Performance Observations

The new CI workflows are well-structured from a build performance perspective:

1. **Concurrency group with cancel-in-progress** — Prevents redundant CI runs on rapid pushes. Saves ~4× CI minutes on active branches.
2. **pnpm cache enabled** — `actions/setup-node` with `cache: pnpm` avoids re-downloading dependencies on every run.
3. **Separate lint/typecheck/test jobs** — These run in parallel, not sequential. A 30s lint job doesn't gate a 10s test run.
4. **Matrix testing (Node 20/22)** — Both run in parallel. Smart validation of the `>=20` engine constraint.

#### [INFO] O2: CI could benefit from build caching

- **File**: `.github/workflows/ci.yml`
- **Description**: The `build` job and `test` job both run `pnpm build` independently. There's no artifact sharing between jobs — each job builds from scratch.
- **Impact**: Adds ~10-20s per CI run. Negligible for current test suite size.
- **Recommendation**: If build time grows, consider uploading `dist/` as an artifact from the `build` job and downloading it in the `test` job. Not actionable now.

### Remaining Observations

#### [INFO] O1 (carried over): Dashboard log reads unbounded

- **File**: `src/dashboard/server.ts:55`
- **Description**: Reads all `.json` files in contributions directory without pagination.
- **Impact**: Negligible for typical use (<100 runs).
- **Recommendation**: Add `?limit=N` when usage warrants.

### Positive Patterns

1. **PQueue universal concurrency** — Every bounded-concurrency need uses PQueue. Consistent and predictable.
2. **Timeout discipline** — Every external I/O call has an explicit timeout.
3. **Memory pressure monitoring** — Edge-triggered with hysteresis. Sophisticated and correct.
4. **CI pnpm caching** — Proper cache strategy for package manager.
5. **No build regression** — Deploy readiness changes introduced zero runtime overhead.

### Recommendations

No new performance recommendations. The source code is well-optimized for a CLI tool. Focus areas remain:
1. **Profile real-world usage** — `oac run` on a 500-file monorepo to validate PQueue concurrency settings
2. **Dashboard pagination** — Add when contribution log count exceeds 100
3. **CI build caching** — Add when build time exceeds 30s

