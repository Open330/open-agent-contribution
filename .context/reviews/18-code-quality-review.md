# Code Quality Review — OAC v2026.4.3

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-18  
**Scope**: Full codebase review (~15,000 LOC, 70+ source files, 30 test files / 354 tests)

---

## Code Quality Review

### Summary
- **Quality Level**: GOOD
- **Score**: 8.5 / 10
- **Must Fix**: 1 issue (blocking correctness)
- **Should Fix**: 5 issues (recommended)
- **Consider**: 3 suggestions (optional)

### Must Fix

#### [CRITICAL] C1: Inconsistent error normalization causes silent retry failures

- **File**: `src/execution/worker.ts:110-135`
- **Issue**: `normalizeExecutionError` only classifies timeout errors. All other errors (OOM, network, git lock) fall through to `AGENT_EXECUTION_FAILED`, which `isTransientError()` in `engine.ts` treats as non-retryable. This means a transient network error caught in the worker will never be retried, while the same error caught in the engine would be. The two code paths produce different behavior for identical error conditions.
- **Fix**: Extract the full normalization logic from `engine.ts:347-427` into a shared function and use it in both locations. Alternatively, let worker throw raw errors and let engine always normalize.

### Should Fix

#### [HIGH] S1: AsyncEventQueue duplicated identically in two adapters

- **File**: `src/execution/agents/claude-code.adapter.ts:35-120`, `src/execution/agents/codex.adapter.ts:36-120`
- **Issue**: ~90 lines of identical code including the class, `TokenState`, and `TokenPatch` interfaces. This is the textbook case for extraction — exact duplication, not similar-but-different logic.
- **Suggestion**: Extract to `src/execution/agents/async-event-queue.ts`. Both adapters import from it.

#### [HIGH] S2: `task.ts` at 601 lines with mixed abstraction levels

- **File**: `src/cli/commands/run/task.ts`
- **Issue**: Contains task discovery, execution orchestration, summary rendering, sandbox management, and adapter resolution — 5+ distinct responsibilities in one file. While it was extracted from a 1,692-line monolith (improvement!), the file itself could be further decomposed.
- **Suggestion**: Consider extracting `resolveAdapter` → `src/execution/agent-registry.ts`, and `printFinalSummary` / `printDryRunSummary` → `src/cli/commands/run/summary.ts`. This would bring `task.ts` under 400 lines.

#### [HIGH] S3: `truncate` function duplicated in scanner

- **File**: `src/discovery/scanners/github-issues-scanner.ts` (local `truncate`), `src/cli/helpers.ts:87` (exported `truncate`)
- **Issue**: The github-issues-scanner defines its own `truncate` function despite an identical one existing in `helpers.ts`.
- **Suggestion**: Import `truncate` from `../../cli/helpers.js` or move the utility to `core/` for cross-layer access.

#### [MEDIUM] S4: Scanner construction duplicated between task and epic

- **File**: `src/cli/commands/run/task.ts` (`selectScannersFromConfig`), `src/cli/commands/run/epic.ts` (`buildScannerList`)
- **Issue**: Similar but subtly different logic for building scanner arrays from config. Easy to get out of sync when adding new scanner types.
- **Suggestion**: Extract a shared `buildScannersFromConfig(config)` function.

#### [MEDIUM] S5: Empty catch blocks suppress useful diagnostics

- **File**: `src/discovery/analyzer.ts:268` (walkSourceFiles), `src/discovery/analyzer.ts:473` (runScanners), `src/execution/engine.ts:191` (agent abort), `src/cli/config-loader.ts:68` (config search)
- **Issue**: Multiple `catch {}` or `catch { continue }` blocks that silently swallow errors. While some are intentional (ignore cleanup failures), others hide real issues (e.g., permission denied on directory walk, scanner initialization failures).
- **Suggestion**: Add debug-level logging in catch blocks: `if (process.env.DEBUG) console.error(...)`. This preserves current behavior while enabling diagnosis when things go wrong.

### Consider

- **C1**: The `readPositiveNumber` helper in `worker.ts:25-31` and input validation in `pipeline.ts:validateRunOptions` follow different validation patterns. Consider standardizing on Zod for all runtime validation (you already use it for config).

- **C2**: Several test files (e.g., `tests/execution/engine.test.ts`) test implementation details by checking internal job states. Consider testing via the public API (`enqueue → run → result`) to make tests more resilient to refactoring.

- **C3**: The `epicAsTask` function in `worker.ts:246-263` calculates complexity from subtask count using magic thresholds (4, 7). Consider extracting these as named constants (`MODERATE_SUBTASK_THRESHOLD`, `COMPLEX_SUBTASK_THRESHOLD`).

### Test Coverage Assessment

- **354 tests across 30 files** — Good coverage for a 15K-LOC project.
- **Execution layer** is well-tested: `engine.test.ts`, `worker.test.ts`, `codex-adapter.test.ts`.
- **Missing coverage**: No tests for `src/cli/commands/run/retry.ts`, `src/cli/commands/run/epic.ts`, or `src/core/memory.ts`.
- **Test quality**: Tests use descriptive names and test behavior over implementation. Good use of mock agents.
- **Edge case gap**: No test for what happens when `estimateTaskMap` is called with an empty task list. No test for `normalizeExecutionError` handling non-Error thrown values.

### Positive Observations

1. **Excellent naming discipline** — `createSpinner`, `withWorktreeLock`, `buildTaskPrompt`, `isTransientError` — all communicate intent clearly.
2. **Single-purpose helper extraction** — The 11 helpers in `helpers.ts` are well-scoped and well-named.
3. **Zod schemas with strict mode** — Prevents unknown fields from silently passing validation.
4. **`OacError` with rich context** — Error objects carry `code`, `severity`, `context`, and `cause` — excellent for debugging.
5. **Clean TypeScript** — No `any` types at module boundaries. Proper use of `type` imports.
6. **Atomic file writes** — `atomicWriteJson` prevents data corruption on crash.
7. **Memory-conscious analysis** — Streaming reads for large files, memory-adaptive concurrency.

