# Performance Review — OAC v2026.4.3

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-18  
**Scope**: Full codebase review (~15,000 LOC) — hot paths, memory, I/O, concurrency

---

## Performance Review

### Summary
- **Risk Level**: ACCEPTABLE (approaching WELL OPTIMIZED)
- **Score**: 9.0 / 10
- **Hot Path Issues**: 2 findings
- **Estimated Impact**: Minor — no critical bottlenecks. Improvements are marginal optimizations.

### Performance Findings

#### [MEDIUM] P1: Unbounded `Promise.all` in `estimateTaskMap`

- **Category**: Concurrency / Resource exhaustion
- **File**: `src/cli/helpers.ts:142-160` (estimateTaskMap function)
- **Description**: `estimateTaskMap` fires all token estimation calls simultaneously via `Promise.all(tasks.map(...))`. Each estimation may spawn a subprocess (agent availability check) or make an API call.
- **Impact**: For 50 tasks (the default `maxTasks`), this creates 50 concurrent subprocess spawns. On resource-constrained CI environments, this can exhaust file descriptors or trigger rate limits.
- **Measurement**: `time oac run --dry-run --max-tasks=50` on a 2-core CI runner vs. local M3.
- **Fix**: Replace with PQueue at concurrency 5-10, matching the pattern used in `analyzer.ts` and `engine.ts`.
- **Expected improvement**: Reduces peak FD usage from O(n) to O(k) where k=concurrency. Prevents rate limit errors.

#### [MEDIUM] P2: Sequential file reads in `readContributionLogs`

- **Category**: I/O / Sequential awaits
- **File**: `src/dashboard/server.ts:readContributionLogs` (for loop with await readFile)
- **Description**: Contribution log files are read one-by-one in a `for` loop. Each `readFile` waits for the previous to complete.
- **Impact**: For a dashboard with 20+ past runs, this adds latency proportional to the number of log files × disk I/O time. On NFS/networked file systems this is more pronounced.
- **Measurement**: Mock 50 log files, measure `readContributionLogs` latency before/after.
- **Fix**: Use `Promise.all` with PQueue (concurrency ~10) to parallelize reads, or read all in parallel since these are small JSON files.
- **Expected improvement**: ~5-10x faster dashboard load with many contribution logs.

#### [LOW] P3: Missing `AbortController` timeout on fetch in GitHub issues scanner

- **Category**: I/O / Missing timeout
- **File**: `src/discovery/scanners/github-issues-scanner.ts:105`
- **Description**: The `fetch(url, ...)` call to GitHub API has no `AbortController` or timeout. If GitHub is slow or unreachable, this hangs indefinitely.
- **Impact**: The entire scan pipeline blocks on a single HTTP call. No progress is visible.
- **Measurement**: Simulate slow GitHub API with a proxy that adds 30s latency.
- **Fix**: Add `signal: AbortSignal.timeout(30_000)` to the fetch options.
- **Expected improvement**: Guaranteed 30s upper bound on network wait; clean error message on timeout.

### Resource Usage Observations

**Memory patterns** — Well managed:
- `createMemoryMonitor` with PQueue throttling in `analyzer.ts` — correct pattern for batch processing.
- Streaming file reads for files >1MB in `analyzeFile` — prevents heap spikes from generated/vendored code.
- `timer.unref()` in memory monitor — won't keep process alive after work completes.
- `AsyncEventQueue` in adapters uses shift-based consumption (no unbounded growth).

**I/O patterns** — Mostly good:
- PQueue used for file analysis (bounded at 50, reduces to 4 under memory pressure).
- `atomicWriteJson` for safe persistence (write-tmp → rename).
- `execa` with array args for all subprocess invocations (no shell overhead).
- Walker uses `Promise.all` for subdirectory traversal (parallel directory reads).

**Concurrency patterns** — Well designed:
- `ExecutionEngine` uses PQueue with configurable concurrency and auto-start control.
- `withWorktreeLock` properly serializes git worktree operations to prevent race conditions.
- Round-robin agent selection in `selectAgent()` distributes load evenly.
- Exponential backoff for rate-limited retries (capped at 60s).

### Positive Patterns

1. **PQueue everywhere** — Bounded concurrency is the default pattern, not an afterthought. 
2. **Memory pressure monitoring** — Edge-triggered (hysteresis) prevents flip-flopping. Concurrency halves on pressure, doubles on relief. Clean implementation.
3. **Streaming for large files** — The 1MB threshold is well-chosen. Export/import extraction is correctly skipped for large files (usually generated/vendored).
4. **Atomic writes** — `atomicWriteJson` prevents data corruption. Simple and effective.
5. **Timeout on task execution** — `DEFAULT_TIMEOUT_MS = 300_000` (5 min) with per-task override. Good defaults.
6. **Retry with backoff** — `isTransientError` classifies 5 error types, with different backoff strategies for rate-limited vs. other transient errors.
7. **`timer.unref()`** — Memory monitor timer won't keep Node.js alive after work drains.

### Recommendations (prioritized by impact)

1. **Bound `estimateTaskMap` with PQueue** — 5-line fix, prevents resource exhaustion on large task lists
2. **Parallelize `readContributionLogs`** — Easy win for dashboard latency with many past runs
3. **Add `AbortSignal.timeout` to GitHub fetch** — 1-line fix, prevents indefinite hangs

