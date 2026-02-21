# Performance Optimization Review — Round 10 — OAC v2026.221.1

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-21  
**Scope**: Multi-user concurrency guard fetch patterns, Codex npx invocation overhead, JSONL envelope parsing per-line cost, `stdin: "ignore"` file descriptor reduction, `AbortSignal.timeout` on new network calls.  
**Previous review**: `37-perf-optimization-review-r9.md` (Score: 9.5/10)

---

## 1. Executive Summary

This round introduces network I/O on two new paths (PR list fetching in scanner and handler) and changes the Codex invocation strategy from direct binary to npx. Both have measurable cost. The scanner's use of `Promise.all` makes Layer 1 free in terms of added latency. The npx cold-start is the only net-new cost (~2-5s first run, ~200ms cached).

**Efficiency score: 9.5/10** — Unchanged. New I/O costs are well-managed. No regressions on hot paths.

---

## 2. Changes — Performance Impact Assessment

| File | Change | Performance Impact |
|------|--------|--------------------|
| `github-issues-scanner.ts` | `fetchOacClaimedIssueNumbers` parallel with issue fetch | ✅ Zero added latency — `Promise.all` runs both fetches concurrently. Single paginated API call (`per_page=100`). |
| `github-issues-scanner.ts` | `AbortSignal.timeout(15_000)` on PR fetch | ✅ Positive — Caps worst-case at 15s. Prevents indefinite hang on GitHub API timeouts. |
| `completion/handler.ts` | `findExistingOacPR` before PR push | ⚠️ +200-500ms — One Octokit `pulls.list` call per PR creation. Sequential, on I/O-bound path. Acceptable. |
| `cli/commands/run/pr.ts` | `findExistingOacPR` before PR push | ⚠️ +200-500ms — Same cost, `fetch()` path. |
| `codex.adapter.ts` | `npx --yes @openai/codex` invocation | ⚠️ +2-5s cold / +200ms warm — npx package resolution on first call. Amortized across tasks. |
| `codex.adapter.ts` | `--json` flag | ✅ Positive — Eliminates TUI rendering overhead. JSON parsing is faster than ANSI escape processing. |
| `codex.adapter.ts` | `--ephemeral` flag | ✅ Neutral — No state I/O between runs. |
| `codex.adapter.ts` | JSONL envelope parsing | ✅ Negligible — One `type === "item.completed"` check per line. Short-circuits before deep parsing. |
| All adapters | `stdin: "ignore"` | ✅ Micro-positive — One fewer fd per subprocess. No stdin pipe buffer allocation. |

---

## 3. Deep Dive — Concurrency Guard Fetch Patterns

### Layer 1: Scanner Parallel Fetch

```
Time ──────────────────────────────────►
  fetchOpenIssues()           ████████████
  fetchOacClaimedIssueNumbers()  █████████
                              ▲           ▲
                          Promise.all  both resolve
```

The PR fetch is strictly parallel with the issue fetch. The longer of the two determines total time. In practice, issue listing is usually slower (more data), so the PR fetch completes within the issue fetch window. **Net cost: 0ms added latency** in typical cases.

### Layer 3: Pre-PR Check

```
Time ──────────────────────────────────────────►
  findExistingOacPR()  ████
  git push              ░░░░████████
  gh pr create               ░░░░░░░████████
```

The guard runs before `git push`. One API call (~200-500ms). This is acceptable — the push + PR creation that follows takes 3-10s. The guard adds <10% to the total PR creation time.

---

## 4. Deep Dive — npx Invocation Overhead

| Scenario | Time | Notes |
|----------|------|-------|
| First `npx @openai/codex` (cold cache) | ~2-5s | Package resolution + potential download |
| Subsequent calls (warm cache) | ~200ms | npx verifies cached package, spawns binary |
| Direct `codex` binary | ~50ms | Direct exec, no npx overhead |

The tradeoff: +150ms per invocation (warm) to avoid the TUI binary hang issue. Since each task execution runs for 60-300s, the 200ms overhead is noise (<0.3% of execution time).

### Availability Check

`checkAvailability()` runs `npx --yes @openai/codex --version` with a 15s timeout. This is a one-time cost during `oac doctor` or first task run. The `--yes` flag auto-confirms package installation, preventing interactive prompts.

---

## 5. Previous Open Items Status

| Item | Status | Notes |
|------|--------|-------|
| Status watch mode flicker (cosmetic) | ⚠️ Open | Not a performance issue |
| Sequential `stat()` in `estimateContextTokens` | ⚠️ Open | LOW — marginal benefit |
| `process.env` spread caching | ⚠️ Open (INFORMATIONAL) | Correct tradeoff — correctness > micro-optimization |

---

## 6. Recommendations

1. **npx warm-up hint** (INFORMATIONAL): For batch operations (multiple tasks in sequence), the first Codex invocation warms the npx cache. Subsequent invocations are ~200ms. No action needed — the system self-optimizes.

2. **PR fetch pagination** (LOW): `fetchOacClaimedIssueNumbers` uses `per_page=100`. For repos with >100 active OAC PRs, pagination would be needed. Currently, no repo has close to this many. The `AbortSignal.timeout(15_000)` caps worst-case regardless.

---

## 7. Score Justification

No performance regressions on hot paths. Layer 1 concurrency guard is free (parallel fetch). Layer 3 adds a single API call on the cold path (PR creation). npx overhead is amortized and insignificant relative to agent execution time. The `--json` flag is a net positive (eliminates TUI rendering). `stdin: "ignore"` is a micro-positive. All new network calls have proper timeouts.

**Efficiency score: 9.5 / 10** (unchanged — new costs are well-managed, no regressions)

