# Performance Optimization Review — Round 9 — OAC v2026.220.1

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-20  
**Scope**: Re-evaluation after OpenCode provider integration, clone system rewrite, config-loader Node compatibility fixes, CalVer versioning.  
**Previous review**: `15-perf-optimization-review-r8.md` (Score: 9.5/10)

---

## 1. Executive Summary

This round covers the largest single addition since the run.ts decomposition: the OpenCode adapter (468 lines) and supporting infrastructure. The clone system was rewritten with retry/fallback logic. Config-loader received a surgical fix for Node < 22.6 compatibility.

**Efficiency score: 9.5/10** — Unchanged. No regressions. New code follows established performance patterns.

---

## 2. Changes — Performance Impact Assessment

| File | Change | Performance Impact |
|------|--------|--------------------|
| `src/execution/agents/opencode.adapter.ts` | 468L new adapter with nd-JSON streaming | ✅ Neutral — Streams output line-by-line via `readline`. Same pattern as existing adapters. |
| `src/execution/agents/registry.ts` | 66L adapter registry | ✅ Negligible — Two `Map.get()` calls instead of if/else chain. O(1) either way. |
| `src/repo/cloner.ts` | Retry + HTTPS→SSH fallback + rolling timeouts | ✅ Positive — Worst-case: adds 21s retry delay before failing. Best-case: identical to before. Prevents infinite hangs via `GIT_TERMINAL_PROMPT=0`. |
| `src/cli/config-loader.ts` | `ERR_UNKNOWN_FILE_EXTENSION` check | ✅ Negligible — One additional `error.code` comparison in error path. |
| `src/cli/commands/run/task.ts` | Registry-based adapter resolution | ✅ Negligible — Map lookup instead of string comparison. |
| `src/repo/resolver.ts` | Store `sshUrl` from GitHub API | ✅ None — One additional field assignment. |
| `scripts/setup-contributor.sh` | New setup script | N/A — Not part of runtime. |

---

## 3. OpenCode Adapter — Deep Dive

### Streaming Architecture

```
execa("opencode", [...]) 
  → subprocess.stdout → readline interface → processStdoutLine() per line
  → subprocess.stderr → readline interface → stderr handler per line
```

This is **memory-optimal**: regardless of how much output the OpenCode CLI produces, OAC buffers at most one line at a time. The `AsyncEventQueue` push is O(1) amortized.

### Token Parsing Performance

The adapter tries 3 levels of token extraction:
1. **JSON payload** → `parseTokenPatchFromPayload()` — direct field access, fastest
2. **Nested `usage` object** — one `isRecord()` check + field access
3. **Regex fallback** — 3 simple regexes on non-JSON lines

Level 1 handles ~95% of cases. The regex fallback (level 3) only fires on non-JSON output — typically rare. The regexes are simple patterns with no catastrophic backtracking risk.

### Process Lifecycle

- `execa` with `reject: false` — no thrown errors on non-zero exit, process result is always available
- `subprocess.pid` exposed for external monitoring
- Abort: SIGTERM → 3s timer → SIGKILL. Timer is `unref()`'d to prevent Node from hanging on shutdown.

**No performance concerns** in the adapter implementation.

---

## 4. Clone System — Timing Analysis

| Scenario | Time Overhead | Notes |
|----------|--------------|-------|
| Happy path (HTTPS, first attempt) | 0s overhead | Identical to before |
| Transient network error | +1s to +21s (backoff) | Appropriate for flaky networks |
| HTTPS auth failure → SSH fallback | +21s max (HTTPS retries) + `rm -rf` + SSH attempt | Correct behavior — SSH is last resort |
| Both HTTPS and SSH fail | +42s total max | Clear combined error message |

Rolling timeouts (`timeout: { block: ms }`) kill the git process if it produces no stdout/stderr for the specified duration. This prevents silent hangs on network partitions where TCP doesn't time out.

---

## 5. Previous Open Items Status

| Item | Status | Notes |
|------|--------|-------|
| All Tier 1/2/3 perf items | ✅ Closed (R8) | No regressions |
| Status watch mode flicker (cosmetic) | ⚠️ Open | Not a performance issue |

---

## 6. Recommendations

1. **Sequential `stat()` in `estimateContextTokens`** (LOW): Could parallelize with `Promise.all`. Marginal benefit for typical file counts (< 20 files).

2. **Consider caching `process.env` spread** (INFORMATIONAL): Both `createGit()` and `OpenCodeAdapter.execute()` spread `process.env` per call. Could cache at module level. However, this would miss env changes during execution — current approach is correct for correctness, and the cost is ~µs per spread.

---

## 7. Score Justification

No performance regressions. The OpenCode adapter follows the streaming pattern established by existing adapters. The clone system adds latency only in failure scenarios (retry backoff), which is the correct tradeoff. The adapter registry adds negligible overhead compared to the previous if/else chain. All timeout values are well-calibrated.

**Efficiency score: 9.5 / 10** (unchanged — no regressions, new code follows established patterns)

