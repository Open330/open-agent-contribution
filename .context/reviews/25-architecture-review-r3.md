# Architecture Review — Round 3 — OAC v2026.4.3

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after deploy readiness fixes (commit `91898c8`). 4 files changed: CI/CD workflows, package.json, README.  
**Previous Score**: 9.6 / 10

---

## Architecture Review

### Summary
- **Overall Assessment**: SOUND
- **Score**: 9.6 / 10 (unchanged)
- **Key Strength**: 4-layer dependency graph remains acyclic with zero circular dependencies across 28 modules. CI/CD infrastructure now mirrors the architectural discipline of the source code.
- **Key Concern**: Agent resolution still a hard-coded switch — unchanged since round-2, deferred to OpenCode milestone.

### Round-2 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| R1 | Agent resolution hard-coded switch | MEDIUM | ⚠️ OPEN (deferred) | `resolveAdapter` in `task.ts:462` still if/else on provider ID. No new providers added — deferral remains appropriate. |
| R2 | `truncate()` defined in 4 places | LOW | ⚠️ OPEN | Still 4 copies: `helpers.ts:64`, `github-issues-scanner.ts:371`, `todo-scanner.ts:395`, `diff-validator.ts:191`. All identical. Crosses the 3+ threshold for extraction. |
| R3 | `task.ts` at 560 lines with mixed concerns | LOW | ⚠️ OPEN | 561 lines now. No net change — deploy readiness fixes didn't touch this file. |

### Dependency Analysis — Post-Fix

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events (foundation)

+ CI/CD (GitHub Actions) ← new infrastructure layer (external)
    └──→ pnpm install → build → lint/typecheck → test
```

- **Circular dependencies**: **0** — Clean.
- **Layer violations**: **0** — CI workflows call `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — they don't import source code directly.
- **Module count**: 28 (unchanged). No new source modules.

### Design Pattern Assessment — Updated

| Pattern | Round-2 | Round-3 | Change |
|---------|---------|---------|--------|
| **Strategy (AgentProvider)** | ✅ Clean | ✅ Clean | No change |
| **Factory (resolveAdapter)** | Hard-coded switch (2 providers) | Hard-coded switch (2 providers) | Deferred — correct decision |
| **Observer (EventBus)** | ✅ Typed events | ✅ Typed events | No change |
| **Composite (CompositeScanner)** | ✅ Single factory | ✅ Single factory | No change |
| **Template Method (error normalization)** | ✅ Shared normalizer | ✅ Shared normalizer | No change |
| **Shared Adapter Primitives** | ✅ `shared.ts` | ✅ `shared.ts` | No change |

### New: Infrastructure Architecture Assessment

#### [POSITIVE] CI/CD Pipeline Design

The newly added CI/CD workflows demonstrate sound infrastructure architecture:

1. **`ci.yml`** — Proper job separation: lint, typecheck, test (matrix), build. Each job is independent and can fail independently. The concurrency group with `cancel-in-progress: true` prevents wasted CI minutes on rapid pushes.

2. **`release.yml`** — Clean two-stage pipeline: publish to npm → create GitHub Release. The `needs: publish` dependency ensures no GitHub Release without a successful npm publish. Uses `--frozen-lockfile` and `--no-git-checks` — correct for CI.

3. **Node.js matrix testing** (20, 22) — Validates the `engines: >=20.0.0` constraint empirically, not just declaratively. Good defense against accidental use of Node 22+ APIs.

#### [LOW] N1: `prepublishOnly` runs full test suite on every publish

- **Category**: Build pipeline efficiency
- **File**: `package.json:44`
- **Description**: `prepublishOnly: "pnpm build && pnpm test"` runs all 354 tests synchronously before publish. For a CLI tool, this is acceptable — but if the test suite grows to 1000+, this becomes a 5+ minute gate on manual publishes.
- **Impact**: Minor — current test suite runs in ~10s. Only relevant at scale.
- **Recommendation**: No action needed now. If test time grows, consider `pnpm build && pnpm test --reporter=dot` for faster feedback during manual publish.

### Remaining Findings

#### [MEDIUM] R1 (carried over): Agent resolution still hard-coded

- **Category**: Extensibility (Open/Closed Principle)
- **File**: `src/cli/commands/run/task.ts:462`
- **Description**: `resolveAdapter` uses if/else on provider ID string. Fine for 2 providers.
- **Impact**: Adding a 3rd provider (OpenCode) means modifying this function.
- **Recommendation**: Unchanged — introduce `Map<ProviderId, () => AgentProvider>` registry when adding OpenCode.

#### [LOW] R2 (carried over): `truncate()` in 4 files

- **Category**: DRY
- **Files**: `helpers.ts`, `github-issues-scanner.ts`, `todo-scanner.ts`, `diff-validator.ts`
- **Description**: 4 identical copies of a 4-line function. Over the 3+ extraction threshold.
- **Recommendation**: Move to `src/core/utils.ts` when convenient.

#### [LOW] R3 (carried over): `task.ts` size

- **Category**: Cohesion
- **File**: `src/cli/commands/run/task.ts` (561 lines)
- **Description**: Still has 5 responsibilities. No single function >80 lines.
- **Recommendation**: Extract when adding OpenCode support.

### Positive Patterns — New

1. **CI concurrency groups** — `cancel-in-progress: true` prevents parallel runs on same branch. Shows infrastructure maturity.
2. **Frozen lockfile in CI** — `--frozen-lockfile` prevents accidental dependency drift. Critical for reproducibility.
3. **Node engine constraint lowered to >=20** — Broadens adoption without sacrificing functionality. Investigation confirmed no Node 22+ APIs in use.
4. **npm `files` array explicit** — `["dist", "README.md", "LICENSE", "CHANGELOG.md", "docs"]` ensures exactly what ships. No `.context/`, no test files, no source. Clean boundary between development and distribution.

### Recommendations (prioritized)

1. **Defer agent registry** — Don't over-engineer for 2 providers (unchanged)
2. **Consolidate `truncate`** → `core/utils.ts` when touching any of the 4 files
3. **Extract `resolveAdapter` + summaries from `task.ts`** when adding OpenCode
4. **Consider `pnpm audit` in CI** — would close the security reviewer's last CI recommendation

