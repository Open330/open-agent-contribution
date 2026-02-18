# Architecture Review — Round 2 — OAC v2026.4.3

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-18  
**Scope**: Re-assessment after Wave 1–4 fixes (21 files changed, +766 −441 lines)  
**Previous Score**: 9.3 / 10

---

## Architecture Review

### Summary
- **Overall Assessment**: SOUND
- **Score**: 9.6 / 10 (+0.3)
- **Key Strength**: Zero circular dependencies maintained across 28 modules (3 new shared modules added cleanly)
- **Key Concern**: Agent resolution remains a hard-coded switch — the only material extensibility gap left

### Round-1 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| F1 | AsyncEventQueue duplicated across adapters | HIGH | ✅ RESOLVED | Extracted to `src/execution/agents/shared.ts` (113 lines). Both adapters import cleanly. Ready for OpenCode adapter. |
| F2 | Error normalization duplicated / inconsistent | HIGH | ✅ RESOLVED | Unified in `src/execution/normalize-error.ts` (88 lines). Handles 6 error types. Worker and engine both delegate to same function. |
| F3 | Scanner construction duplicated task/epic/analyze | MEDIUM | ✅ RESOLVED | `src/discovery/scanner-factory.ts` (61 lines) is now the single source of truth. All 3 consumers delegate to `buildScanners()`. |
| F4 | Agent resolution is hard-coded switch | MEDIUM | ⚠️ OPEN | `resolveAdapter` in `task.ts:462` is still an if/else on provider ID. Acceptable for 2 providers; will need registry when OpenCode lands. |
| F5 | `estimateTaskMap` unbounded Promise.all | LOW | ✅ RESOLVED | Now uses `PQueue({ concurrency: 10 })`. Consistent with codebase patterns. |

### Dependency Analysis — Post-Fix

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events (foundation)
```

- **Circular dependencies**: **0** — Still clean. The 3 new shared modules (`shared.ts`, `normalize-error.ts`, `scanner-factory.ts`) all respect inward dependency flow.
- **Layer violations**: **0** — `scanner-factory.ts` lives in `discovery/` and imports only from `core/` and sibling scanner files. `normalize-error.ts` lives in `execution/` and imports only from `core/`. `shared.ts` lives alongside the adapters it serves.
- **New module count**: 28 (was 25). All 3 additions are well-scoped shared modules with clear single responsibilities.

### Design Pattern Assessment — Updated

| Pattern | Round-1 | Round-2 | Change |
|---------|---------|---------|--------|
| **Strategy (AgentProvider)** | ✅ Clean | ✅ Clean | No change needed |
| **Factory (resolveAdapter)** | Hard-coded switch | Hard-coded switch | Still 2 providers — registry deferred to OpenCode milestone |
| **Observer (EventBus)** | ✅ Typed events | ✅ Typed events | No change needed |
| **Composite (CompositeScanner)** | Duplicated construction | ✅ Single factory | `buildScanners()` is now the sole constructor |
| **Template Method (error normalization)** | Duplicated, inconsistent | ✅ Single shared normalizer | `normalizeExecutionError()` is canonical |
| **Shared Adapter Primitives** | Missing layer | ✅ `shared.ts` | New pattern — clean extraction |

### Remaining Findings

#### [MEDIUM] R1: Agent resolution still hard-coded

- **Category**: Extensibility
- **File**: `src/cli/commands/run/task.ts:462`
- **Description**: `resolveAdapter` uses if/else on provider ID string. Fine for 2 providers, but the roadmap lists OpenCode.
- **Impact**: Adding a 3rd provider means modifying this function. Violates Open/Closed for a known extension point.
- **Recommendation**: Defer to OpenCode milestone — when adding the 3rd provider, introduce a `Map<ProviderId, () => AgentProvider>` registry. Don't over-engineer for 2 cases. **Priority: LOW (until OpenCode is ready).**

#### [LOW] R2: `truncate()` still locally defined in 3 scanner files

- **Category**: DRY
- **Files**: `src/discovery/scanners/github-issues-scanner.ts:371`, `src/discovery/scanners/todo-scanner.ts:395`, `src/completion/diff-validator.ts:191` — each has a local `truncate()` identical to `src/cli/helpers.ts:64`
- **Description**: 4 copies of the same 4-line function. Not blocking, but violates the YAGNI-over-DRY threshold (3+ copies → extract).
- **Recommendation**: Move `truncate` to `src/core/utils.ts` or keep in `helpers.ts` and import from there. Low priority.

#### [LOW] R3: `task.ts` still at 560 lines

- **Category**: Cohesion
- **File**: `src/cli/commands/run/task.ts` (560 lines, down from 601)
- **Description**: File shrank ~40 lines from scanner dedup, but still contains 5 responsibilities (discovery, execution, summary, sandbox management, adapter resolution).
- **Impact**: Manageable at 560 lines. No single function exceeds 80 lines.
- **Recommendation**: Extract `resolveAdapter` and `printFinalSummary` when touching this file next. Not urgent.

### Positive Patterns — New

1. **Clean shared module extractions** — All 3 new modules (`shared.ts`, `normalize-error.ts`, `scanner-factory.ts`) are focused, well-documented, and respect layer boundaries. This is exactly how shared code should be introduced.
2. **Consistent re-export pattern** — `src/discovery/index.ts` re-exports `scanner-factory.ts`, maintaining the barrel pattern. `src/execution/index.ts` doesn't need to re-export `normalize-error.ts` since it's used internally.
3. **Branch validation in sandbox** — The `SAFE_BRANCH_RE` regex in `sandbox.ts` is a clean input validation pattern that doesn't over-complicate the flow.
4. **Net LOC reduction** — 441 lines removed vs 766 added, but the additions include 3 new modules (262 lines) and 4 review docs (388 lines). Core logic actually shrank by ~180 lines.

### Recommendations (prioritized)

1. **Defer agent registry to OpenCode milestone** — Don't introduce a registry pattern for 2 providers
2. **Consolidate `truncate` into core/utils** — 4 copies now exist; move when convenient
3. **Further decompose `task.ts`** — Extract `resolveAdapter` + summaries when adding OpenCode

