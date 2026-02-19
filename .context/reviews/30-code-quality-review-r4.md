# Code Quality Review — Round 4 — OAC v2026.4.3

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after utility consolidation and catch block annotation (commit `55780e4`). 17 files changed: `core/utils.ts` created, `truncate`/`isRecord` imports unified, 10 empty catch blocks annotated.  
**Previous Score**: 9.2 / 10

---

## Code Quality Review

### Summary
- **Quality Level**: GOOD (approaching EXCELLENT)
- **Score**: 9.4 / 10 (+0.2)
- **Must Fix**: 0 issues
- **Should Fix**: 1 issue (carried over, reduced scope)
- **Consider**: 3 suggestions (2 carried over, 1 revised)

### Round-3 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S2 | `task.ts` mixed responsibilities (560 lines) | MEDIUM | ⚠️ OPEN (deferred) | 560 lines, 5 concerns. Deferred to OpenCode milestone — same assessment. |
| S5 | Empty catch blocks (10 occurrences) | LOW | ✅ **RESOLVED** | All 10 catch blocks now annotated with `// best-effort: <reason>` comments. Each explains why the error is intentionally swallowed. |
| C3 | `isRecord` in 4 locations | LOW | ✅ **RESOLVED** | Consolidated to `src/core/utils.ts:25`. All 4 consumers now import from core. `normalize-error.ts` re-exports for convenience. |

### Should Fix

#### [MEDIUM] S2 (carried over): `task.ts` mixed responsibilities

- **File**: `src/cli/commands/run/task.ts` (560 lines)
- **Issue**: Contains 5 concerns: discovery orchestration, execution, summary rendering, sandbox management, adapter resolution. The Wave 5 decomposition split the original 1,691-line monolith into 8 modules, but `task.ts` absorbed the heaviest parts.
- **Note**: No single function exceeds 80 lines. The code is well-structured within the file — the concern is file-level cohesion, not function-level quality.
- **Suggestion**: When adding OpenCode provider, extract:
  - `resolveAdapter` → `src/execution/agent-registry.ts`
  - `printFinalSummary` + `printDryRunSummary` → `src/cli/commands/run/summary.ts`
  - This would bring `task.ts` to ~380 lines.

### Consider

- **C1 (carried over)**: Standardize runtime input validation on Zod. `readPositiveNumber` in `worker.ts` and `validateRunOptions` in `pipeline.ts` use ad-hoc validation while config uses Zod. Low priority — the ad-hoc validators are correct and simple.

- **C2 (carried over)**: Some tests inspect internal job states (`engine.test.ts` checks `job.status` directly). Prefer testing via public API for refactoring resilience. Low priority — tests are stable and comprehensive.

- **C3 (revised)**: The `truncate` re-export pattern (`helpers.ts` re-exports from `core/utils.ts`, `normalize-error.ts` re-exports `isRecord`) creates two levels of indirection for some consumers. This is acceptable and pragmatic — it keeps import paths short for frequent CLI-layer consumers. No action needed.

### Test Coverage Assessment

- **354 tests across 30 files** — unchanged. All passing.
- **No dedicated tests for**: `core/utils.ts` (indirectly tested via consumers), `normalize-error.ts`, `scanner-factory.ts`, `retry.ts`, `epic.ts`, `memory.ts`.
- **Recommendation**: Consider adding a small unit test file for `core/utils.ts` to test `truncate` edge cases (empty string, maxLength < ellipsis length, unicode). Low priority — it's a 4-line function.

### Positive Observations — New

1. **Single source of truth for primitives** — `truncate()` and `isRecord()` each have exactly one definition. Any future behavior change propagates everywhere automatically. This was the #1 code quality concern from round-2 — now resolved.
2. **Annotated catch blocks** — Every empty `catch {}` now has a `// best-effort: <reason>` comment. This documents intent clearly for the next reader. The `sandbox.ts` pattern (`.catch(() => {}).then(fn)`) is particularly well-explained.
3. **Consistent import patterns** — All `truncate` imports in the discovery/completion layers go directly to `core/utils.js`. CLI layer goes through `helpers.js` re-export. Clear convention.
4. **`core/` module is now complete** — `types.ts`, `errors.ts`, `config.ts`, `events.ts`, `memory.ts`, `utils.ts`, `index.ts`. Every cross-cutting concern has a home.

