# Architecture Review — Round 6 — OAC v2026.221.1

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-21  
**Scope**: Multi-user concurrency guards (Layer 1 discovery filter + Layer 3 pre-PR duplicate check), Codex TUI binary fix (npx invocation pattern, `stdin: "ignore"`), JSONL envelope parsing refinements, systematic `stdin: "ignore"` across all adapters. 8 files changed.  
**Previous Score**: 9.8 / 10

---

## Architecture Review

### Summary
- **Overall Assessment**: EXCELLENT
- **Score**: 9.8 / 10 (unchanged)
- **Key Strength**: The two-layer concurrency guard (Layer 1 at discovery, Layer 3 at PR creation) is a textbook defense-in-depth pattern. Each layer operates independently, so a failure in one doesn't compromise the other.
- **Key Concern**: `findExistingOacPR()` is implemented twice — once in `completion/handler.ts` (Octokit) and once in `cli/commands/run/pr.ts` (gh CLI / fetch). The duplication is justified by the two code paths using different HTTP clients, but the logic is identical.

### Round-5 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| R2 | `task.ts` at 555 lines with mixed concerns | LOW | ⚠️ OPEN (deferred) | Unchanged. No new code added to task.ts. |
| A6 | `registry.ts` singleton pattern risk | LOW | ⚠️ OPEN | Still valid. No test isolation issues observed. |

### New Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| A7 | Two-layer concurrency guard is architecturally sound | — | POSITIVE — Layer 1 (`fetchOacClaimedIssueNumbers` in scanner) filters at discovery time using `Promise.all` for parallel fetching. Layer 3 (`findExistingOacPR` in handler/pr) guards at PR creation. Independent failure domains: Layer 1 failure still discovers the issue; Layer 3 failure logs and proceeds (doesn't block). |
| A8 | Duplicated `findExistingOacPR` in two code paths | LOW | `handler.ts` uses Octokit `pulls.list`, `pr.ts` uses `fetch()` with GitHub REST API. Same logic, different HTTP clients. This is a conscious tradeoff — the two paths serve different execution contexts (programmatic vs CLI). Consider extracting to a shared utility if a third path emerges. |
| A9 | Codex npx invocation pattern is well-isolated | — | POSITIVE — `codexNpxFallback()` encapsulates the npx detection logic. `execute()` always spawns via `npx @openai/codex` with `CODEX_MANAGED_BY_NPM: "1"`. The env var signals the Codex binary to skip self-update checks. Clean separation of availability detection vs execution. |
| A10 | `stdin: "ignore"` applied systematically across all adapters | — | POSITIVE — All three adapters (Claude Code, Codex, OpenCode) and `doctor.ts` now use `stdin: "ignore"`. This is a cross-cutting concern applied consistently. No stdin-dependent code paths remain. |
| A11 | Codex JSONL envelope parsing is layered correctly | — | POSITIVE — `parseFileEditFromPayload` handles `item.completed` → `file_change` envelope first (lines 151-161), then falls through to direct payload parsing. `parseToolUseFromPayload` handles `item.completed` → `command_execution`. The envelope unwrapping is a thin layer atop existing parsers — no duplication. |
| A12 | `completion:duplicatePRGuard` progress event | — | POSITIVE — The guard emits a typed progress event before checking, maintaining the observable event stream pattern. Callers (dashboard, CLI) can display guard status without coupling to implementation. |

### Dependency Analysis — Post-Changes

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events, Utils (foundation)

Concurrency guard flow:
  github-issues-scanner.ts → [Layer 1] fetchOacClaimedIssueNumbers() → GitHub REST API (PRs)
  completion/handler.ts    → [Layer 3] findExistingOacPR() → Octokit pulls.list
  cli/commands/run/pr.ts   → [Layer 3] findExistingOacPR() → fetch() GitHub REST API
```

- **Circular dependencies**: **0** — Clean.
- **Layer violations**: **0** — Scanner (discovery layer) fetches PRs from GitHub API (same layer as issue fetching). Handler (completion layer) checks PRs before creating them (same layer concern).
- **Module count**: 31 (unchanged).

### Architecture Metrics

| Metric | R5 | R6 | Delta |
|--------|----|----|-------|
| Circular deps | 0 | 0 | — |
| Layer violations | 0 | 0 | — |
| Largest module | 555L (`task.ts`) | 608L (`codex.adapter.ts`) | New largest module |
| Concurrency safety | None | Two-layer guard | ✅ Major improvement |
| Subprocess stdin handling | Inconsistent | `stdin: "ignore"` everywhere | ✅ Systematic fix |
| Codex invocation | Direct binary | npx with env flag | ✅ Resilient to TUI binary |

### Recommendations

1. **A8 — Shared concurrency guard utility** (LOW): If a third code path needs `findExistingOacPR`, extract the core logic into a shared function that accepts a generic HTTP fetcher. Not needed yet — two implementations is the threshold for tolerable duplication.

2. **R2 — task.ts decomposition** (LOW, deferred): Still 555L. The next feature touching task.ts should trigger decomposition.

### Score Justification

The two-layer concurrency guard is the most architecturally significant addition this round. It follows defense-in-depth principles with independent failure domains. The Codex npx pattern is cleanly isolated. `stdin: "ignore"` is applied systematically. The `findExistingOacPR` duplication is a pragmatic tradeoff. No regressions. `codex.adapter.ts` is now the largest module at 608L — worth monitoring but well-structured internally (14 helpers + 1 class).

**Score: 9.8 / 10**

