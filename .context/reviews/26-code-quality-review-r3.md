# Code Quality Review — Round 3 — OAC v2026.4.3

**Reviewer**: code-quality-reviewer (Staff Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after deploy readiness fixes (commit `91898c8`). Package.json, CI/CD, README changes only — no source code modifications.  
**Previous Score**: 9.2 / 10

---

## Code Quality Review

### Summary
- **Quality Level**: GOOD (approaching EXCELLENT)
- **Score**: 9.2 / 10 (unchanged)
- **Must Fix**: 0 issues
- **Should Fix**: 2 issues (carried over from round-2)
- **Consider**: 4 suggestions (1 new, 3 carried over)

### Round-2 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S2 | `task.ts` at 560 lines with mixed responsibilities | MEDIUM | ⚠️ OPEN | 561 lines. No source changes in this round. Still contains discovery, execution, summary, sandbox, adapter resolution. |
| S5 | Empty catch blocks in scanners/analyzer | LOW | ⚠️ OPEN | Down to 10 occurrences (from 20+ previously reported — re-counted accurately). All are in non-critical paths: `github-pr.ts:145`, `ui.ts` (6×), `claude-code.adapter.ts:53`, `codex.adapter.ts:43`, `sandbox.ts:20`. |

### Should Fix

#### [MEDIUM] S2 (carried over): `task.ts` mixed responsibilities

- **File**: `src/cli/commands/run/task.ts` (561 lines)
- **Issue**: Contains 5 concerns: discovery orchestration, execution, summary rendering, sandbox management, adapter resolution. The `run.ts` decomposition (Wave 5) split the monolith into 8 modules, but `task.ts` absorbed the heaviest parts.
- **Suggestion**: When next touching this file, extract:
  - `resolveAdapter` → `src/execution/agent-registry.ts`
  - `printFinalSummary` + `printDryRunSummary` → `src/cli/commands/run/summary.ts`
  - This would bring `task.ts` to ~380 lines.

#### [LOW] S5 (revised): Empty catch blocks — re-count

- **Files**: 10 occurrences across 5 files (accurate recount):
  - `github-pr.ts:145` — best-effort PR status check
  - `ui.ts:545,552,559,570,578,586` — best-effort dashboard UI data parsing
  - `claude-code.adapter.ts:53` — best-effort JSON parse of agent output
  - `codex.adapter.ts:43` — best-effort JSON parse of agent output
  - `sandbox.ts:20` — worktree lock recovery (intentional)
- **Suggestion**: Add `// best-effort: <reason>` comments. The `sandbox.ts:20` usage is architecturally correct (`.catch(() => {}).then(fn)` — intentional swallow for chaining).

### Consider

- **C1 (carried over)**: Standardize runtime input validation on Zod. `readPositiveNumber` in `worker.ts` and `validateRunOptions` in `pipeline.ts` use ad-hoc validation while config uses Zod.

- **C2 (carried over)**: Some tests inspect internal job states (`engine.test.ts` checks `job.status` directly). Prefer testing via public API for refactoring resilience.

- **C3 (carried over)**: `isRecord` defined in **4 separate locations** (worse than round-2 assessment of 2):
  - `src/execution/agents/shared.ts:94` (exported, used by both adapters)
  - `src/execution/normalize-error.ts:3` (local)
  - `src/cli/commands/status.ts:228` (local)
  - `src/cli/commands/leaderboard.ts:267` (local)
  
  Consolidate to `src/core/utils.ts` and import everywhere.

- **C4 (new)**: `prepublishOnly` script is a safety net — good practice. However, the CI workflow also runs `pnpm build && pnpm test`. Consider extracting a `validate` script to DRY the CI config:
  ```json
  "validate": "pnpm build && pnpm test",
  "prepublishOnly": "pnpm validate"
  ```

### Test Coverage Assessment

- **354 tests across 30 files** — unchanged. All passing.
- **Still no dedicated tests for**: `normalize-error.ts`, `shared.ts`, `scanner-factory.ts`, `retry.ts`, `epic.ts`, `memory.ts`. All are indirectly covered through integration tests.
- **New CI coverage**: The `ci.yml` workflow now runs the full test suite on Node 20 and 22. This is a significant improvement — tests are no longer dev-machine-only.
- **Recommendation**: Add unit tests for `normalizeExecutionError` edge cases and `retry.ts` when touching those files. The CI matrix provides confidence in cross-version compatibility.

### Positive Observations — New

1. **`prepublishOnly` safety net** — `pnpm build && pnpm test` prevents publishing broken builds. This is the #1 most impactful quality gate for an npm package.
2. **`--frozen-lockfile` in CI** — Catches accidental dependency changes that only work locally.
3. **Explicit `files` array** — Only ships `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`, `docs`. No test files, no `.context/`, no source. Clean package boundary.
4. **Node >=20 constraint** — Proper investigation confirmed no Node 22+ APIs. Data-driven engine lowering, not guesswork.
5. **CI job separation** — lint, typecheck, test, build as separate jobs. A failure in lint doesn't block knowing about test failures. Good developer experience.

