# Code Quality Review — Round 2 — OAC v2026.4.3

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-18  
**Scope**: Re-assessment after Wave 1–4 fixes (21 files changed, +766 −441 lines)  
**Previous Score**: 8.5 / 10

---

## Code Quality Review

### Summary
- **Quality Level**: GOOD (approaching EXCELLENT)
- **Score**: 9.2 / 10 (+0.7)
- **Must Fix**: 0 issues
- **Should Fix**: 2 issues (both carried over, reduced severity)
- **Consider**: 3 suggestions (1 new, 2 carried over)

### Round-1 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| C1 | Inconsistent error normalization → broken retry | CRITICAL | ✅ RESOLVED | `normalizeExecutionError` in `normalize-error.ts` is now the single source of truth. Both engine and worker delegate to it. All 6 error patterns (timeout, OOM, network, git lock, abort, generic) are handled consistently. Retry logic now works correctly for all transient errors. |
| S1 | AsyncEventQueue duplicated in 2 adapters | HIGH | ✅ RESOLVED | Clean extraction to `shared.ts`. Includes `TokenState`, `TokenPatch`, `isRecord`, `readNumber`, `readString`. Good JSDoc header. |
| S2 | `task.ts` at 601 lines with 5+ responsibilities | HIGH | ⚠️ IMPROVED | Down to 560 lines (−41). Scanner construction moved to factory. Still has multiple responsibilities but no function exceeds 80 lines. Reduced from HIGH to MEDIUM. |
| S3 | `truncate` duplicated in scanner | HIGH | ⚠️ OPEN | Still 4 local copies. Was 3 — `diff-validator.ts` also has one. Reduced severity to LOW (function is trivial). |
| S4 | Scanner construction duplicated task/epic | MEDIUM | ✅ RESOLVED | `scanner-factory.ts` with `buildScanners()` is clean, well-typed, and used by all 3 consumers. |
| S5 | Empty catch blocks suppress diagnostics | MEDIUM | ⚠️ OPEN | Still 20+ `catch {}` blocks across scanners and analyzers. Most are intentional (file access, best-effort parsing), but some would benefit from debug logging. |

### Should Fix

#### [MEDIUM] S2 (revised): `task.ts` still has mixed responsibilities

- **File**: `src/cli/commands/run/task.ts` (560 lines)
- **Issue**: Contains discovery orchestration, execution, summary rendering, sandbox management, and adapter resolution. Down from 601 lines — scanner construction was extracted.
- **Suggestion**: When next touching this file (e.g., for OpenCode support), extract `resolveAdapter` → `src/execution/agent-registry.ts` and `printFinalSummary` / `printDryRunSummary` → `src/cli/commands/run/summary.ts`. Would bring it to ~400 lines.

#### [LOW] S5 (revised): Empty catch blocks in scanners and analyzer

- **Files**: `src/discovery/analyzer.ts` (4 occurrences), `src/discovery/scanners/*.ts` (12 occurrences), `src/completion/diff-validator.ts` (2 occurrences)
- **Issue**: 20+ `catch {}` blocks. Most are intentional best-effort operations (reading optional files, parsing non-critical metadata), but lack any indication of what was suppressed.
- **Suggestion**: Add a consistent `// best-effort: <reason>` comment inside each empty catch. For the 4 in `analyzer.ts`, consider `if (process.env.DEBUG) console.error(...)` to aid diagnosis. Not blocking.

### Consider

- **C1 (carried over)**: Standardize runtime input validation on Zod. `readPositiveNumber` in `worker.ts` and `validateRunOptions` in `pipeline.ts` use ad-hoc validation while config uses Zod. Consistency would reduce cognitive load.

- **C2 (carried over)**: Some tests check internal job states. `engine.test.ts` inspects `job.status` directly. Prefer testing via public API (`enqueue → run → result`) for refactoring resilience.

- **C3 (new)**: The new `normalize-error.ts` exports both `isRecord` and `toErrorMessage` as named exports alongside `normalizeExecutionError`. These utility functions are also defined in `shared.ts`. Consider a single `isRecord` source in `core/utils.ts` to avoid the dual definition. Not urgent — they're tiny functions and the modules have different consumers.

### Test Coverage Assessment

- **354 tests across 30 files** — unchanged. All passing.
- **New code not yet tested**: `normalize-error.ts`, `shared.ts`, `scanner-factory.ts` don't have dedicated test files. However:
  - `normalizeExecutionError` is indirectly tested through `engine.test.ts` and `worker.test.ts`
  - `AsyncEventQueue` is indirectly tested through `codex-adapter.test.ts`
  - `buildScanners` is indirectly tested through scanner-related tests
- **Still missing**: No tests for `retry.ts`, `epic.ts`, or `memory.ts`.
- **Recommendation**: Add unit tests for `normalizeExecutionError` edge cases (non-Error thrown values, each pattern match). Low priority — the function is well-structured and indirectly covered.

### Positive Observations — New

1. **Clean extraction pattern** — The shared modules follow a consistent pattern: JSDoc header explaining origin, focused exports, no side effects. `shared.ts` is a textbook example of DRY extraction done right.
2. **Type safety maintained** — All new modules are fully typed. `buildScanners` returns a typed tuple `{ names, instances, composite }` that provides both type safety and convenience.
3. **`normalizeExecutionError` is comprehensive** — 6 error patterns with clear regex matching, proper context propagation, and cause chaining. This is significantly better than the split logic it replaced.
4. **Net complexity reduction** — The engine's `normalizeError` went from 80 lines to a 7-line delegation. The adapters each lost 112 lines of duplication. The codebase is simpler.
5. **Branch validation** — `SAFE_BRANCH_RE` with dual validation (branch + base branch) is clean and defensive without being verbose.

