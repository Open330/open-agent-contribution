# Performance Review — Round 5 — OAC v2026.220.1

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-20  
**Scope**: OpenCode adapter execution path, adapter registry lookup, clone retry/timeout patterns, config-loader fallback, process env spreading.  
**Previous Score**: 9.5 / 10

---

## Performance Review

### Summary
- **Overall Assessment**: STRONG
- **Score**: 9.5 / 10 (unchanged)
- **Key Strength**: The clone system's retry with exponential backoff and rolling timeouts prevents both infinite hangs and premature failures. The 5min/2min timeout split is well-calibrated for clone vs fetch operations.
- **Key Concern**: `process.env` spreading on every `createGit()` call and every OpenCode adapter invocation creates shallow copies of the full environment. Negligible for CLI usage but worth noting.

### Round-4 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| P1 | `estimateTaskMap` sequential estimation | MEDIUM | ✅ Resolved in R3 | PQueue-based, unchanged. |
| P2 | Status watch mode flicker | LOW | ⚠️ OPEN | Cosmetic, not a performance issue. |

### New Findings — Performance Impact Assessment

| # | Code Path | Finding | Severity | Impact |
|---|-----------|---------|----------|--------|
| P3 | `createGit()` — `{ ...process.env }` | Env object spread on every git operation | LOW | ~50-200 env vars shallow-copied per call. Microseconds. Correct tradeoff — the alternative (cached env) would miss runtime env changes. |
| P4 | `OpenCodeAdapter.execute()` — `Object.fromEntries(Object.entries(process.env).filter(...))` | Full env iteration + filter + fromEntries per execution | LOW | Single allocation per task execution (~50-200 entries). Well within noise floor. |
| P5 | `retryGitOperation` — exponential backoff [1s, 4s, 16s] | Total worst-case wait: 21 seconds before final attempt | — | POSITIVE — Backoff progression is reasonable. 4 attempts total (1 initial + 3 retries). Won't hammer a rate-limited server. |
| P6 | `cloneNewRepository` — HTTPS→SSH fallback with `cleanPartialClone` | `rm -rf` on partial clone directory before SSH retry | — | POSITIVE — Cleans up corrupted state. `rm` is fast and the alternative (git reusing corrupt .git/) would be much slower. |
| P7 | `AdapterRegistry.get()` — double Map lookup (aliases then factories) | Two `Map.get()` calls per adapter resolution | — | O(1) × 2 = O(1). Irrelevant. |
| P8 | `parseTokenEvent` — regex fallback for text parsing | 3 regex matches on every non-JSON stdout line | LOW | Regexes are simple (no backtracking risk). Lines are typically < 200 chars. Only fires when JSON parsing fails — rare in normal operation. |
| P9 | `readline` interface for nd-JSON streaming | Per-line processing of stdout/stderr | — | POSITIVE — Memory-efficient. Only one line buffered at a time regardless of output volume. Better than buffering entire stdout then splitting. |
| P10 | `estimateContextTokens` — sequential `stat()` calls | Files stat'd one at a time in a for loop | LOW | Only runs during token estimation (not hot path). Typical file count < 20. Could use `Promise.all` but benefit is marginal. |
| P11 | `forceKillTimer.unref()` in abort | Timer won't keep Node process alive | — | POSITIVE — Prevents the process from hanging if abort is called during shutdown. Good practice. |

### Hot Path Analysis

The critical hot path for OpenCode execution:
```
execute() → execa spawn → readline stream → parseJsonPayload → per-line event dispatch
```

Each step is streaming and non-blocking. No full-output buffering. The `AsyncEventQueue` push is O(1). This is optimal for long-running agent processes that may produce thousands of output lines.

### Timeout Architecture

| Operation | Timeout | Type | Assessment |
|-----------|---------|------|-----------|
| Clone | 5 min (`GIT_CLONE_TIMEOUT_MS`) | Rolling (block) | ✅ Appropriate for large repos |
| Fetch | 2 min (`GIT_FETCH_TIMEOUT_MS`) | Rolling (block) | ✅ Appropriate for shallow fetch |
| OpenCode execution | `params.timeoutMs` (configurable) | Process timeout via execa | ✅ Per-task, user-configurable |
| Abort escalation | 3 sec SIGTERM→SIGKILL | Fixed | ✅ Standard graceful shutdown pattern |

### Recommendations

1. **P10 — Parallel stat** (LOW): Consider `Promise.all(targetFiles.map(f => stat(f).catch(() => null)))` in `estimateContextTokens`. Minor improvement for large file lists.

2. **P3/P4 — Document env spreading** (INFORMATIONAL): Add a brief comment explaining why env is spread rather than cached, to prevent future "optimization" that would break env propagation.

### Score Justification

No performance regressions introduced. The clone system adds retry latency only on failure (correct). The OpenCode adapter streams output line-by-line (memory-efficient). The adapter registry adds negligible lookup overhead. All timeout values are well-chosen. The env spreading pattern is the correct tradeoff between correctness and micro-optimization.

**Score: 9.5 / 10**

