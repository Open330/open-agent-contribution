# Performance Review — Round 6 — OAC v2026.221.1

**Reviewer**: performance-reviewer (Senior Performance Engineer)  
**Date**: 2026-02-21  
**Scope**: Concurrency guard fetch calls (Layer 1 parallel PR fetch, Layer 3 pre-PR check), Codex npx invocation overhead, JSONL envelope parsing per-line cost, `stdin: "ignore"` on all subprocess spawns.  
**Previous Score**: 9.5 / 10

---

## Performance Review

### Summary
- **Overall Assessment**: STRONG
- **Score**: 9.5 / 10 (unchanged)
- **Key Strength**: Layer 1 uses `Promise.all` to fetch issues and OAC PRs in parallel — zero additional latency on the happy path. The 15-second `AbortSignal.timeout` on PR fetches prevents scanner hangs.
- **Key Concern**: `npx --yes @openai/codex` adds cold-start overhead (~2-5s) on first invocation per session. Acceptable for a CLI tool but worth noting.

### Round-5 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| P2 | Status watch mode flicker | LOW | ⚠️ OPEN | Cosmetic, unchanged. |
| P10 | Sequential `stat()` in `estimateContextTokens` | LOW | ⚠️ OPEN | Unchanged. |

### New Findings — Performance Impact Assessment

| # | Code Path | Finding | Severity | Impact |
|---|-----------|---------|----------|--------|
| P12 | `fetchOacClaimedIssueNumbers` — parallel with issue fetch | `Promise.all([fetchOpenIssues, fetchOacClaimedIssueNumbers])` | — | POSITIVE — PR fetch runs concurrently with issue fetch. No added latency on the critical path. Single API call with `per_page=100`, paginated if needed. |
| P13 | `fetchOacClaimedIssueNumbers` — `AbortSignal.timeout(15_000)` | 15s timeout on PR list fetch | — | POSITIVE — Prevents scanner from hanging on slow GitHub API responses. Timeout is generous enough for large repos (100 PRs per page). |
| P14 | Layer 3 `findExistingOacPR` — single API call per PR creation | One `pulls.list` (or `fetch`) call with `state=open` filter | LOW | Adds ~200-500ms per PR creation (one GitHub API round-trip). Acceptable — PR creation is already an I/O-bound operation. |
| P15 | `extractClaimedIssueNumbers` — regex on PR bodies | Iterates all fetched PRs, applies regex to each body | — | Negligible — `per_page=100` caps iteration. Regex is simple (`/(?:fixes|closes|resolves)\s+#(\d+)/gi`) with no catastrophic backtracking. |
| P16 | Codex `npx --yes @openai/codex` cold start | npx resolves and potentially downloads package on first run | LOW | ~2-5s first invocation, ~200ms cached. This runs once per task execution, not per line. Acceptable tradeoff for TUI binary compatibility. |
| P17 | Codex JSONL envelope unwrapping | Additional `type === "item.completed"` check per parsed line | — | Negligible — One string comparison per stdout line. The envelope check short-circuits before deeper parsing. |
| P18 | `stdin: "ignore"` on all execa spawns | Closes stdin fd immediately | — | POSITIVE — Reduces open file descriptors by 1 per subprocess. Prevents buffering on unused stdin pipe. Micro-optimization but correct. |
| P19 | Codex `--json` flag | Forces JSON output mode | — | POSITIVE — Eliminates TUI escape sequence parsing overhead. JSON lines are faster to parse than ANSI-decorated output. |

### Hot Path Analysis — Concurrency Guards

```
Discovery phase (parallel):
  fetchOpenIssues()  ──┐
                       ├──→ Promise.all ──→ filter claimed ──→ return issues
  fetchOacClaimedIssueNumbers() ──┘

PR creation phase (sequential):
  findExistingOacPR() → if exists: skip → else: git push → gh pr create
```

Layer 1 adds zero latency (parallel). Layer 3 adds one API call (~200-500ms) on the PR creation path, which is inherently sequential and I/O-bound. No performance regression.

### Timeout Architecture — Updated

| Operation | Timeout | Type | Assessment |
|-----------|---------|------|-----------|
| Clone | 5 min | Rolling (block) | ✅ Unchanged |
| Fetch | 2 min | Rolling (block) | ✅ Unchanged |
| OAC PR list fetch | 15 sec | AbortSignal | ✅ New — appropriate for API call |
| Codex availability check | 15 sec | execa timeout | ✅ New — generous for npx resolution |
| Agent execution | configurable | Per-task | ✅ Unchanged |
| Abort escalation | 3 sec SIGTERM→SIGKILL | Fixed | ✅ Unchanged |

### Recommendations

1. **P10 — Parallel stat** (LOW, carried over): `estimateContextTokens` still uses sequential `stat()`. Minor.

2. **P16 — npx caching note** (INFORMATIONAL): Consider documenting that first Codex invocation may be slower due to npx package resolution. Users running multiple tasks in sequence won't notice after the first run.

### Score Justification

No performance regressions. The concurrency guards add minimal overhead — Layer 1 is fully parallel, Layer 3 adds one API call on the PR creation path. The npx invocation adds cold-start latency but only once per session. JSONL envelope parsing adds negligible per-line overhead. `stdin: "ignore"` is a micro-positive. All new timeouts are well-calibrated.

**Score: 9.5 / 10**

