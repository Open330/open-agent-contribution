# Architecture Review — Round 5 — OAC v2026.220.1

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-20  
**Scope**: Re-assessment after OpenCode provider integration, adapter registry pattern, clone system rewrite, config-loader fixes. 19 files changed (+903/−58): `opencode.adapter.ts` (468L new), `registry.ts` (66L new), `cloner.ts` (+90/−20), `config-loader.ts` (+6), `task.ts` (registry migration), `resolver.ts` (+sshUrl), `types.ts` (+sshUrl), setup script (172L new), CalVer version scheme.  
**Previous Score**: 9.7 / 10

---

## Architecture Review

### Summary
- **Overall Assessment**: EXCELLENT
- **Score**: 9.8 / 10 (+0.1)
- **Key Strength**: The `AdapterRegistry` pattern resolves the last significant architectural debt — the hard-coded provider switch in `resolveAdapter`. The system now supports runtime registration of custom adapters with zero modification to existing code paths.
- **Key Concern**: `task.ts` at 555 lines remains the largest single module. Still well-structured internally but approaching the threshold where a second decomposition pass would improve navigability.

### Round-4 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| R1 | Agent resolution hard-coded switch | MEDIUM | ✅ **RESOLVED** | `AdapterRegistry` in `registry.ts` replaces if/else chain. `resolveAdapter()` in `task.ts:461-486` now uses `adapterRegistry.resolveId()` + `adapterRegistry.get()`. Extensible via `register()` and `alias()`. |
| R2 | `task.ts` at 560 lines with mixed concerns | LOW | ⚠️ OPEN (deferred) | Now 555 lines. Slight reduction from registry extraction. Functions are well-separated (discovery, execution, printing, adapter resolution). Deferral still appropriate. |

### New Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| A1 | OpenCode adapter follows established pattern perfectly | — | POSITIVE — `OpenCodeAdapter` mirrors `ClaudeCodeAdapter` / `CodexAdapter` in interface conformance. `AgentProvider` interface remains the single contract. |
| A2 | Clone system HTTPS→SSH fallback is well-layered | — | POSITIVE — `cloneNewRepository` and `pullExistingClone` both implement the same fallback pattern independently, keeping each flow self-contained. |
| A3 | `createGit()` helper centralizes simple-git configuration | — | POSITIVE — Single point of truth for env spreading and timeout configuration. The `NOTE` comment documenting the `.env()` gotcha is excellent defensive documentation. |
| A4 | Config-loader dual-path fallback is clean | LOW | The `shouldTryLegacyDefineConfigFallback` function handles two distinct failure modes (Node < 22.6 extension error vs Node ≥ 22.6 resolution error) in a clear conditional chain. |
| A5 | Setup script lives outside src/ boundary | — | POSITIVE — `scripts/setup-contributor.sh` is a deployment concern, correctly separated from application code. |
| A6 | `registry.ts` singleton pattern risk | LOW | Global `adapterRegistry` singleton is fine for CLI but could cause test isolation issues if tests mutate the registry. Currently not a problem — tests don't modify it. |

### Dependency Analysis — Post-Changes

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events, Utils (foundation)

Execution layer:
  agent.interface.ts  ← contract
  shared.ts           ← common utilities (AsyncEventQueue, TokenState, etc.)
  registry.ts         ← adapter registry (NEW)
  claude-code.adapter.ts
  codex.adapter.ts
  opencode.adapter.ts ← NEW
```

- **Circular dependencies**: **0** — Clean.
- **Layer violations**: **0** — `registry.ts` imports only from adapter implementations (same layer). `task.ts` imports `adapterRegistry` through `execution/index.ts` barrel.
- **Module count**: 31 (+2 — `registry.ts`, `opencode.adapter.ts`).

### Architecture Metrics

| Metric | R4 | R5 | Delta |
|--------|----|----|-------|
| Circular deps | 0 | 0 | — |
| Layer violations | 0 | 0 | — |
| Largest module | 560L (`task.ts`) | 555L (`task.ts`) | −5L |
| Provider extensibility | Hard-coded switch | Registry pattern | ✅ Major improvement |
| Git operation resilience | Basic HTTPS | HTTPS + SSH fallback + retry + rolling timeout | ✅ Major improvement |
| Config compat | Node ≥ 22.6 only | Node ≥ 20 | ✅ Broadened |

### Recommendations

1. **A6 — Registry test isolation** (LOW): Consider exporting the `AdapterRegistry` class for tests to create isolated instances, rather than always using the global singleton. Not blocking — current test suite doesn't need it.

2. **R2 — task.ts decomposition** (LOW, deferred): When the next major feature touches task.ts, consider extracting `resolveAdapter` + adapter-related logic into a separate `adapter-resolution.ts` module. The function is already self-contained.

### Score Justification

The adapter registry pattern is exactly the right solution at the right time — introduced alongside the third provider (OpenCode), not prematurely. The clone system rewrite demonstrates mature error handling (retry → fallback → clear error messages). Config-loader changes are minimal and surgical. Overall architecture is now at its strongest point in the project's history.

**Score: 9.8 / 10**

