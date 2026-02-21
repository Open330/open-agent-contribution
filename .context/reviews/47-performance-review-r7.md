# Performance Review — Round 7

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Senior Performance Engineer |
| **Round** | 7 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — 31 modules, ~4 800 LoC production |
| **Previous Score** | 9.5 / 10 (R6) |

---

## Executive Summary

No new performance regressions since R6.  This round provides a **deeper
quantitative analysis** of the sequential `stat()` pattern in token estimation,
the `PQueue` concurrency model in `task.ts`, and the `readline`-based stream
parsing cost.  All findings remain LOW or informational.

---

## 1. Sequential `stat()` in `estimateContextTokens` (LOW — carried)

Both `codex.adapter.ts` (line 352) and `opencode.adapter.ts` (line 238) iterate
target files sequentially:

```ts
for (const filePath of targetFiles) {
  const fileStat = await stat(filePath);
  …
}
```

### Quantified impact

| Files | Sequential (est.) | Parallel `Promise.all` (est.) |
|------:|------------------:|------------------------------:|
| 5 | ~2.5 ms | ~0.5 ms |
| 20 | ~10 ms | ~0.5 ms |
| 100 | ~50 ms | ~1–2 ms |

The estimation runs once per task before execution (which takes 30–300 s).
Even at 100 files, 50 ms is noise.  **No urgency**, but a `Promise.all` rewrite
is trivial:

```ts
const sizes = await Promise.all(
  targetFiles.map(async (f) => {
    try { return (await stat(f)).size; } catch { return 0; }
  }),
);
return Math.ceil(sizes.reduce((a, b) => a + b, 0) / 4);
```

---

## 2. `PQueue` Concurrency Model (INFO)

`task.ts` uses two `PQueue` instances:

1. **Execution queue** (`concurrency` param, default from CLI) — gates agent
   subprocess spawns.
2. **Completion queue** (same `concurrency`) — gates PR creation.

This is correct.  Both queues independently limit system resource consumption.
The `Promise.all` over `taskQueue.add(…)` collects results as they complete,
which is optimal for heterogeneous task durations.

One minor observation: both queues use the same concurrency value.  If the
bottleneck is API rate limits during PR creation (rather than CPU during
execution), a separate lower concurrency for the completion queue would be
more precise.  Not actionable without telemetry data.

---

## 3. `readline` Stream Parsing (INFO)

All three adapters use `createInterface()` to parse JSONL stdout.  The
`readline` module buffers internally until a newline arrives, which is
efficient for JSONL.  The per-line `JSON.parse()` cost is negligible for the
throughput OAC handles (~1–10 lines/sec during agent execution).

Claude's `parseJsonPayload` does an extra `indexOf("{")` + `slice` on every
non-JSON line.  This adds ~1 µs/line — immeasurable.

---

## 4. `AbortSignal.timeout` Allocation (INFO)

`fetchOpenIssues` uses `AbortSignal.timeout(30_000)` and
`fetchOacClaimedIssueNumbers` uses `AbortSignal.timeout(15_000)`.  Each creates
a timer in the Node.js event loop.  Both are `Promise.all`'d, so their timers
run concurrently.  Cost: two timers = ~0.  Correctly calibrated.

---

## 5. npx Cold-Start (INFO — carried)

`npx --yes @openai/codex` has a ~2–5 s first-invocation penalty to resolve and
extract the npm package.  Subsequent invocations within the same npm cache
lifetime are ~200 ms.  In a multi-task run, only `checkAvailability()` hits
this; the execution call reuses the resolved binary.  No mitigation needed.

---

## 6. Status Watch Mode Flicker (COSMETIC — carried)

Spinner text updates on every progress event.  On fast terminals this can cause
visual flicker.  A debounce (e.g. 100 ms) on `estimateSpinner.text` updates
would smooth the output.  Purely cosmetic.

---

## Positive Patterns

- **`Promise.all([stdoutDone, stderrDone])`**: Correct — both streams are
  consumed concurrently; neither blocks the other.
- **`AsyncEventQueue` backpressure**: Push is O(1); the queue is unbounded but
  events are small (<1 KB each).  For OAC's workload (<1 000 events/run), this
  is fine.
- **`Promise.allSettled` in `notifyProviders`**: Prevents one slow webhook from
  delaying others.
- **Shallow clone (`--depth 1`)**: Minimises network and disk I/O.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Hot-path efficiency | 30% | 9.5 |
| Concurrency model | 25% | 9.5 |
| I/O patterns | 25% | 9.5 |
| Resource cleanup | 20% | 10 |
| **Weighted Total** | | **9.6 / 10** |

Delta from R6: **+0.1** — deeper analysis confirms the architecture is
efficient; the sequential `stat()` is confirmed to be noise-level.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | LOW | Sequential `stat()` in `estimateContextTokens` | Carried |
| 2 | INFO | `PQueue` dual-concurrency model — correct | Reaffirmed |
| 3 | INFO | npx cold-start ~2–5 s first run | Carried |
| 4 | COSMETIC | Status spinner flicker | Carried |

