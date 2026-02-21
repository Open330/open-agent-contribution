# Architecture Review — Round 7

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Principal Software Architect |
| **Round** | 7 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — 31 modules, ~4 800 LoC production, ~7 845 LoC tests |
| **Previous Score** | 9.8 / 10 (R6) |

---

## Executive Summary

OAC's architecture remains exceptionally clean for a CLI tool of this complexity.
The adapter-per-agent pattern, the two-layer concurrency guard, and the
factory-backed registry all continue to hold up well.  This round digs into
**cross-adapter code duplication** — an issue that was flagged at LOW in R6 but
whose scope is larger than previously reported.  We also examine the **divergent
abort-timeout values** across the three adapters.

---

## 1. Cross-Adapter Duplication (MEDIUM — upgraded from LOW)

### What changed since R6

Deep line-by-line comparison reveals **nine functions** that are duplicated
across two or three adapters with no semantic difference (only the agent-name
string varies):

| Function | Codex | Claude | OpenCode | Identical? |
|----------|:-----:|:------:|:--------:|:----------:|
| `parseTokenPatchFromPayload` | ✓ | ✓ | ✓ | yes |
| `patchTokenState` | ✓ | ✓ | ✓ | yes |
| `normalizeFileAction` | ✓ | ✓ | ✓ | yes |
| `computeTotalTokens` | ✓ | ✓ | ✓ | yes |
| `normalizeExitCode` | ✓ | ✓ | ✓ | yes |
| `hasBooleanFlag` | ✓ | ✓ | ✓ | yes |
| `buildFailureMessage` | ✓ | ✓ | ✓ | agent-name only |
| `normalizeUnknownError` | ✓ | ✓ | ✓ | agent-name only |
| `estimateTokenCount` | ✓ | — | ✓ | yes |

Total: **~220 duplicated lines** that could live in `shared.ts`.

### Why upgrade to MEDIUM

- The prior shared.ts extraction (types + `AsyncEventQueue` + utilities) proved
  the pattern works.  Leaving ~220 lines duplicated is an active drift risk:
  fixing a parsing bug in one adapter but not the other two would silently break
  parity.
- `buildFailureMessage` and `normalizeUnknownError` differ only in the
  agent-name string.  A `(agentName: string) => …` factory trivially unifies
  them.

### Recommendation

Move the nine functions into `shared.ts`.  For the two that embed an agent name,
accept it as a parameter.  Estimated net deletion: **~200 lines**.

---

## 2. Divergent Abort Timeouts (LOW)

| Adapter | SIGTERM → SIGKILL delay |
|---------|:-----------------------:|
| Claude Code | 5 000 ms |
| Codex | 2 000 ms |
| OpenCode | 3 000 ms |

No documented rationale exists for the different values.  The Claude adapter
allows 2.5× more graceful-shutdown time than Codex, but Claude's `-p` mode exits
faster than Codex's `--ephemeral`.  Consider standardising on a single constant
(e.g. `AGENT_GRACEFUL_SHUTDOWN_MS = 3_000`) in `shared.ts`.

---

## 3. `findExistingOacPR` Duplication (LOW — carried)

Two independent implementations exist:

1. `CompletionHandler.findExistingOacPR` — uses Octokit (typed, pagination-aware)
2. `pr.ts::findExistingOacPR` — uses raw `fetch()` (no `encodeURIComponent` on
   `repoFullName`)

The `pr.ts` version also has a subtle encoding gap (see Security R7 for details).
Architecturally, the duplication is intentional (two independent failure domains),
but the implementation quality differs.

---

## 4. `task.ts` as a God Module (LOW — carried)

At 555 lines, `task.ts` mixes discovery invocation, execution orchestration,
completion/PR creation, and CLI rendering.  The file has grown by +1 line since
R6 (whitespace) and the concern mix remains unchanged.  Extraction into
`task-discovery.ts`, `task-executor.ts`, and `task-renderer.ts` would improve
testability.

---

## 5. Registry `register()` Publicly Callable (LOW — carried)

`AdapterRegistry.register()` is public.  A malicious or buggy plugin could
replace a built-in adapter.  Mitigated by the `adapterRegistry` being a
module-level singleton not exposed in the public API surface.

---

## Positive Patterns Reaffirmed

- **Factory registry**: Each pipeline run gets an independent adapter instance
  with its own `runningExecutions` map.
- **Defense-in-depth concurrency guard**: Layer 1 (discovery) + Layer 3
  (pre-PR) are independent — either can fail without affecting the other.
- **`AsyncEventQueue`**: Elegant async-iterable queue bridges imperative push
  and async-for-of consumption.  Clean `close()`/`fail()` lifecycle.
- **Process env filtering**: All three adapters filter `undefined` values from
  `process.env` before spreading, avoiding the `Record<string, string>` footgun.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Module boundaries | 30% | 9.5 |
| Extension points | 20% | 10 |
| Dependency direction | 20% | 10 |
| Failure isolation | 20% | 10 |
| DRY / abstraction | 10% | 8.5 |
| **Weighted Total** | | **9.7 / 10** |

Delta from R6: **−0.1** — the duplication scope is larger than R6 acknowledged
and now warrants a dedicated extraction pass.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | MEDIUM | Cross-adapter duplication (~220L) | NEW ↑ from LOW |
| 2 | LOW | Divergent abort timeouts | NEW |
| 3 | LOW | `findExistingOacPR` duplication | Carried |
| 4 | LOW | `task.ts` god module (555L) | Carried |
| 5 | LOW | Registry `register()` publicly callable | Carried |

