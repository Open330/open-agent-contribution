# Architecture Review — Round 4 — OAC v2026.4.3

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after utility consolidation and CI hardening (commit `55780e4`). 17 files changed: new `core/utils.ts`, updated imports across 14 source files, SHA-pinned CI actions, added `pnpm audit` job.  
**Previous Score**: 9.6 / 10

---

## Architecture Review

### Summary
- **Overall Assessment**: SOUND
- **Score**: 9.7 / 10 (+0.1)
- **Key Strength**: Zero code duplication across module boundaries for shared primitives. The `core/utils.ts` module completes the foundation layer — every shared utility now lives in `core/`.
- **Key Concern**: `resolveAdapter` hard-coded switch — unchanged, correctly deferred to OpenCode milestone.

### Round-3 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| R1 | Agent resolution hard-coded switch | MEDIUM | ⚠️ OPEN (deferred) | `resolveAdapter` in `task.ts:462` still if/else. Deferral remains correct — no 3rd provider yet. |
| R2 | `truncate()` defined in 4 places | LOW | ✅ **RESOLVED** | Consolidated to `src/core/utils.ts:10`. All 4 consumers now import from core. `helpers.ts` re-exports for CLI layer convenience. |
| R3 | `task.ts` at 560 lines with mixed concerns | LOW | ⚠️ OPEN (deferred) | 560 lines. Deferred to OpenCode milestone — still appropriate. |

### Dependency Analysis — Post-Fix

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events, Utils (foundation)
                                                       ^^^^^ NEW

+ CI/CD (GitHub Actions) ← SHA-pinned, audit-gated
```

- **Circular dependencies**: **0** — Clean.
- **Layer violations**: **0** — All `truncate`/`isRecord` imports flow downward to `core/utils.ts`. No upward dependencies introduced.
- **Module count**: 29 (+1 — `core/utils.ts`).
- **New dependency direction**: `completion → core`, `discovery → core`, `execution → core`, `cli → core` — all correct (domain/presentation → foundation).

### Design Pattern Assessment — Updated

| Pattern | Round-3 | Round-4 | Change |
|---------|---------|---------|--------|
| **Strategy (AgentProvider)** | ✅ Clean | ✅ Clean | — |
| **Factory (resolveAdapter)** | Hard-coded (2) | Hard-coded (2) | Deferred |
| **Observer (EventBus)** | ✅ Typed | ✅ Typed | — |
| **Composite (CompositeScanner)** | ✅ Factory | ✅ Factory | — |
| **Shared Primitives** | Duplicated across layers | ✅ **Consolidated in `core/`** | Fixed |

### Findings

#### [MEDIUM] R1 (carried over): Agent resolution hard-coded

- **Category**: Extensibility (Open/Closed Principle)
- **File**: `src/cli/commands/run/task.ts:462`
- **Description**: `resolveAdapter` uses if/else on provider ID string. Fine for 2 providers.
- **Impact**: Adding a 3rd provider means modifying this function.
- **Recommendation**: Introduce `Map<ProviderId, () => AgentProvider>` registry when adding OpenCode.

#### [LOW] R3 (carried over): `task.ts` size

- **Category**: Cohesion
- **File**: `src/cli/commands/run/task.ts` (560 lines)
- **Description**: 5 responsibilities remain. No single function >80 lines. All functions are well-named and focused.
- **Recommendation**: Extract `resolveAdapter` → `agent-registry.ts` and summary functions → `summary.ts` when adding OpenCode.

### Positive Patterns — New

1. **`core/utils.ts` as the primitive home** — `truncate()` and `isRecord()` now have a single source of truth. The pattern is clear: cross-cutting primitives → `core/utils.ts`. Future utilities (e.g., `slugify`, `retry`) have a natural home.
2. **Re-export strategy** — `helpers.ts` re-exports `truncate` from core, and `normalize-error.ts` re-exports `isRecord`. This keeps import paths short for frequent consumers without duplicating code.
3. **SHA-pinned CI** — All 6 action references in `ci.yml` and 3 in `release.yml` use commit SHAs with version comments. This is the gold standard for CI supply chain security.
4. **Dependency audit in CI** — `pnpm audit --prod --audit-level=high` catches vulnerable transitive dependencies before they reach npm. Completes the CI security posture.

### Recommendations (prioritized)

1. **Defer agent registry** — Don't over-engineer for 2 providers (unchanged)
2. **Extract from `task.ts`** when adding OpenCode — `resolveAdapter` + summary functions
3. **No other architectural actions needed** — the codebase is architecturally sound

