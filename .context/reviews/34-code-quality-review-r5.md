# Code Quality Review — Round 5 — OAC v2026.220.1

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-20  
**Scope**: OpenCode adapter (468L), adapter registry (66L), clone system rewrite (223L), config-loader fixes, task.ts registry migration, setup script, type fixes in doctor/explain/init.  
**Previous Score**: 9.4 / 10

---

## Code Quality Review

### Summary
- **Overall Assessment**: HIGH QUALITY
- **Score**: 9.5 / 10 (+0.1)
- **Key Strength**: The OpenCode adapter at 468 lines is remarkably well-organized — 14 pure helper functions at module scope followed by a single class with 4 public methods. Each helper has a single responsibility and is trivially testable.
- **Key Concern**: Test coverage for the new OpenCode adapter is not visible in the diff. The adapter has complex branching (nd-JSON parsing, error categorization, abort escalation) that warrants dedicated unit tests.

### Round-4 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| Q1 | Duplicated `isRecord`/`readString` across adapters | LOW | ✅ **RESOLVED** | Extracted to `shared.ts` and imported by all adapters. |
| Q2 | `task.ts` mixed concerns | LOW | ⚠️ OPEN (deferred) | 555 lines. Registry migration reduced coupling but not size. |

### New Findings

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| Q3 | OpenCode adapter helper function quality | — | POSITIVE — All 14 helpers (`parseJsonPayload`, `parseTokenPatchFromPayload`, `patchTokenState`, etc.) are pure functions with clear input→output contracts. `normalizeUnknownError` correctly categorizes 5 error classes with regex patterns. |
| Q4 | `cloner.ts` — defensive `createGit()` docstring | — | POSITIVE — The multi-line comment explaining simple-git's `.env()` gotcha (lines 200-208) is exemplary. This prevents future developers from reintroducing the bug. |
| Q5 | Registry class is minimal and correct | — | POSITIVE — 54 lines, 5 methods, no over-engineering. The `aliases` map for `codex-cli → codex` is a clean way to handle legacy IDs without polluting the main factory map. |
| Q6 | Config-loader `shouldTryLegacyDefineConfigFallback` | — | POSITIVE — Two-branch conditional is clear and well-commented. Each branch has an inline comment explaining *when* it triggers (Node < 22.6 vs Node ≥ 22.6). |
| Q7 | `normalizeFileAction` type narrowing | — | POSITIVE — Using explicit equality checks against literal strings is safer than `as` casts. Returns `undefined` for unknown values rather than throwing. |
| Q8 | Missing test coverage for OpenCode adapter | MEDIUM | The adapter has complex parsing logic (nd-JSON, token extraction with 3 fallback levels, file edit detection from tool names, error categorization). No adapter-specific tests are visible in the diff. The shared `AsyncEventQueue` and helper functions would benefit from unit tests. |
| Q9 | `retryGitOperation` generic signature | — | POSITIVE — `<T>(operation: () => Promise<T>) => Promise<T>` is cleanly generic. Backoff array `[1000, 4000, 16000]` as `const` prevents mutation. |
| Q10 | `commitSandboxChanges` catches everything | LOW | The catch block at `task.ts:456` swallows all errors and returns `{ hasChanges: false }`. While defensive, it could mask git configuration issues. Consider logging a debug-level warning. |
| Q11 | OpenCode process env filtering | — | Clean — `Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')` correctly handles `undefined` env values that Node.js allows. |

### Naming and Readability

| Item | Assessment |
|------|-----------|
| Function names | ✅ Consistent verb-noun pattern: `parseJsonPayload`, `normalizeUnknownError`, `cleanPartialClone`, `ensureOriginRemote` |
| Variable names | ✅ Clear: `httpsError`, `sshError`, `forceKillTimer`, `canonicalId`, `tokenState` |
| Type names | ✅ `AdapterFactory`, `RunningProcess`, `TokenPatch`, `TokenState` — all self-documenting |
| Comments | ✅ Comments explain *why*, not *what*: "best-effort: agent output may not be valid JSON", "The cache clone is disposable" |

### Complexity Assessment

| File | Cyclomatic Complexity | Assessment |
|------|-----------------------|-----------|
| `opencode.adapter.ts` | Low per function (each helper ≤ 3 branches), moderate aggregate | ✅ Well-decomposed |
| `registry.ts` | Very low (5 methods, no branching) | ✅ Excellent |
| `cloner.ts` | Moderate (`cloneNewRepository` has try→catch→try→catch nesting) | ✅ Acceptable — HTTPS/SSH fallback inherently requires nested error handling |
| `config-loader.ts` | Low (2 conditions in `shouldTryLegacyDefineConfigFallback`) | ✅ Minimal |

### Recommendations

1. **Q8 — OpenCode adapter tests** (MEDIUM): Add unit tests for `parseTokenPatchFromPayload`, `parseFileEditFromPayload`, `normalizeUnknownError`, and the `execute()` flow with mocked `execa`. These are pure functions — easy to test in isolation.

2. **Q10 — Silent catch in commitSandboxChanges** (LOW): Add a debug-level log or emit a trace event when the catch fires, to aid debugging when sandbox commits silently fail.

### Score Justification

Code quality remains high and has improved slightly. The OpenCode adapter demonstrates mature patterns (pure helpers, single-responsibility class, defensive error handling). The registry is refreshingly simple. The clone system fix is well-documented. The gap is test coverage for the new adapter code — the parsing logic is complex enough to warrant dedicated tests.

**Score: 9.5 / 10**

