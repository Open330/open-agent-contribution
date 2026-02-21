# Code Quality Review — Round 6 — OAC v2026.221.1

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-21  
**Scope**: Multi-user concurrency guards, Codex adapter JSONL envelope parsing, npx invocation refactor, `stdin: "ignore"` standardization, test coverage expansion (+4 scanner tests, +4 handler tests, +1 envelope test, +1 config-loader test).  
**Previous Score**: 9.5 / 10

---

## Code Quality Review

### Summary
- **Overall Assessment**: HIGH QUALITY
- **Score**: 9.6 / 10 (+0.1)
- **Key Strength**: Test coverage improved significantly — the concurrency guards and Codex envelope parsing all ship with dedicated tests. `extractClaimedIssueNumbers()` is a pure function that's trivially testable. The test helpers (`makePR()`, `mockFetchByUrl()`) are well-designed.
- **Key Concern**: `findExistingOacPR()` exists in two files with identical logic but different HTTP clients. Not blocking but a DRY smell.

### Round-5 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| Q2 | `task.ts` mixed concerns | LOW | ⚠️ OPEN (deferred) | Unchanged at 555L. |
| Q8 | Missing test coverage for OpenCode adapter | MEDIUM | ⚠️ OPEN | OpenCode adapter still lacks dedicated tests. However, `stdin: "ignore"` was applied to its `execute()` — a positive change covered by the systematic fix. |
| Q10 | Silent catch in `commitSandboxChanges` | LOW | ⚠️ OPEN | Still swallows errors. |

### New Findings

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| Q12 | `extractClaimedIssueNumbers()` is a model pure function | — | POSITIVE — Takes a `PullRequest[]` array, returns `Set<number>`. Regex pattern `/(?:fixes\|closes\|resolves)\s+#(\d+)/gi` correctly handles all GitHub auto-close keywords. Case-insensitive. The function is exported and tested directly. |
| Q13 | `fetchOacClaimedIssueNumbers()` error resilience | — | POSITIVE — Wrapped in try/catch returning empty set on failure. `AbortSignal.timeout(15_000)` prevents hung fetches. The `catch` is intentional — Layer 1 is best-effort, not blocking. |
| Q14 | Test helper quality: `makePR()` and `mockFetchByUrl()` | — | POSITIVE — `makePR()` factory with sensible defaults reduces test boilerplate. `mockFetchByUrl()` multiplexes mock responses by URL pattern, enabling dual-endpoint testing (issues + PRs) in a single test. |
| Q15 | Codex envelope parsing: clean unwrapping | — | POSITIVE — `parseFileEditFromPayload` checks for `item.completed` envelope wrapping `file_change`, unwraps, and delegates to existing field extraction. No duplication of the inner parsing logic. |
| Q16 | `parseToolUseFromPayload` function structure | — | POSITIVE — Handles both `item.completed` → `command_execution` envelope and direct `function_call` payloads. Returns `undefined` for unrecognized payloads (fail-open, consistent with other parsers). |
| Q17 | Duplicated `findExistingOacPR` logic | LOW | `handler.ts` (Octokit) and `pr.ts` (fetch) implement the same duplicate-PR check. Both filter by `[OAC]` prefix and issue number in body. The HTTP client difference is the only distinction. Consider a shared predicate function that both paths can use. |
| Q18 | `--json` and `--ephemeral` flags on Codex spawn | — | POSITIVE — `--json` ensures structured output (no TUI escape codes). `--ephemeral` prevents state persistence across runs. Both are correct for headless operation. |
| Q19 | Doctor `checkCodexCli()` with npx fallback | — | POSITIVE — Tries `npx --yes @openai/codex --version` first, then bare `codex`. Warns user if only bare binary found (TUI issue). Clear diagnostic messaging. |
| Q20 | Codex adapter test coverage significantly improved | — | POSITIVE — New envelope parsing test (lines 358-432) covers `command_execution` and `file_change` envelopes. Updated assertions verify `--json`, `--ephemeral`, `-C` flags and `CODEX_MANAGED_BY_NPM` env var. |

### Naming and Readability

| Item | Assessment |
|------|-----------|
| Function names | ✅ `fetchOacClaimedIssueNumbers`, `extractClaimedIssueNumbers`, `findExistingOacPR`, `codexNpxFallback` — all self-documenting |
| Constants | ✅ `OAC_PR_PAGE_SIZE = 100`, `OAC_PR_TITLE_PREFIX = "[OAC]"` — named constants prevent magic values |
| Test descriptions | ✅ "filters out issues already claimed by OAC PRs", "skips PR creation when duplicate OAC PR exists" — behavior-focused |
| Error messages | ✅ Handler duplicate guard: clear skip message with PR number. Scanner: silent degradation (correct for best-effort). |

### Complexity Assessment

| File | Cyclomatic Complexity | Assessment |
|------|-----------------------|-----------|
| `github-issues-scanner.ts` | Moderate (new `fetchOacClaimedIssueNumbers` adds 1 try/catch + filter) | ✅ Well-contained |
| `completion/handler.ts` | Moderate (`findExistingOacPR` is a straightforward API call + filter) | ✅ Clean |
| `cli/commands/run/pr.ts` | Moderate (same pattern as handler, different client) | ✅ Clean |
| `codex.adapter.ts` | Moderate-high (608L, but well-decomposed into helpers) | ⚠️ Largest module now |
| `doctor.ts` | Low additional (new `checkCodexCli` is linear) | ✅ Clean |

### Recommendations

1. **Q17 — Shared duplicate-PR predicate** (LOW): Extract the PR-matching logic (`title.startsWith("[OAC]")` + body contains `#issueNumber`) into a shared predicate. Both code paths would call the same function with their respective PR data.

2. **Q8 — OpenCode adapter tests** (MEDIUM, carried over): Still the gap in test coverage. The adapter's nd-JSON parsing and error categorization warrant dedicated unit tests.

### Score Justification

Test coverage took a major leap this round — concurrency guards, envelope parsing, and config-loader all ship with tests. The pure function pattern for `extractClaimedIssueNumbers` is exemplary. Code naming is consistently clear. The `findExistingOacPR` duplication is the only quality concern, and it's a pragmatic tradeoff. `codex.adapter.ts` at 608L is now the largest module but remains well-organized.

**Score: 9.6 / 10**

