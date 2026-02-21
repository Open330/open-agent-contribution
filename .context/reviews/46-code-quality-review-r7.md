# Code Quality Review — Round 7

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Staff Engineer — Code Quality |
| **Round** | 7 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — 31 modules, ~4 800 LoC production, 30 test files (~7 845 LoC) |
| **Previous Score** | 9.6 / 10 (R6) |

---

## Executive Summary

Code quality remains high.  Deep-dive this round surfaces **two missing
`stdin: "ignore"` calls** in adapter availability checks and a **hardcoded
agent name** in a provider-agnostic commit message.  Test coverage gaps for
the Claude Code and OpenCode adapters persist.

---

## 1. Missing `stdin: "ignore"` in `checkAvailability()` (MEDIUM)

The systematic `stdin: "ignore"` hardening applied in v2026.220.1 missed two
spots:

| Adapter | File | Line | Call |
|---------|------|------|------|
| Claude Code | `claude-code.adapter.ts` | 336 | `execa("claude", ["--version"], { reject: false })` |
| OpenCode | `opencode.adapter.ts` | 261 | `execa("opencode", ["--version"], { reject: false })` |

The Codex adapter's `checkAvailability()` (line 376) correctly passes
`stdin: "ignore"`.  The `doctor.ts` helper `runCommand()` also correctly
passes it.

**Risk**: If the `claude` or `opencode` binary prompts for input (e.g. first-
run setup, license acceptance), the availability check hangs indefinitely in CI.

**Fix**: Add `stdin: "ignore"` to both calls.  One-line change each.

---

## 2. Hardcoded "Codex CLI" in Commit Message (LOW)

`task.ts` line 445:

```
`[OAC] ${task.title}\n\nAutomated contribution by OAC using Codex CLI.`
```

This message is used regardless of whether the actual provider is Claude Code
or OpenCode.  The provider name should be injected from `adapter.name`.

---

## 3. Adapter Test Coverage Gaps (MEDIUM — carried + expanded)

| Adapter | Dedicated test file | Lines |
|---------|:-------------------:|------:|
| Codex | `codex-adapter.test.ts` | 530 |
| Claude Code | — | 0 |
| OpenCode | — | 0 |

R6 flagged the OpenCode gap.  Claude Code is equally untested at the adapter
level.  Given the three adapters share ~70% identical logic, a shared test
harness with parameterized adapter factories would cover all three efficiently.

---

## 4. Blank Line at `opencode.adapter.ts:144` (COSMETIC)

Two consecutive blank lines between `parseFileEditFromPayload` and
`parseToolUseFromPayload`.  Linter usually catches this; the OpenCode adapter
was likely hand-edited.

---

## 5. Silent Catch in `commitSandboxChanges` (LOW — carried)

`task.ts` lines 456–458: bare `catch {}` swallows all errors including git
permission failures, disk-full, and corrupt index.  A `catch (error) { log(…) }`
would surface these in verbose mode without breaking the pipeline.

---

## 6. `parseJsonPayload` Divergence (LOW)

Three slightly different implementations:

- **Codex / OpenCode**: Try `JSON.parse(trimmed)` directly.
- **Claude Code**: Also extracts a `{…}` fragment if the full line isn't valid
  JSON (handles Claude's mixed text+JSON output).

This is *intentional* divergence — Claude's output format differs.  However,
the Codex and OpenCode versions are byte-identical and should be shared via
`shared.ts`.

---

## Positive Observations

- **Type narrowing discipline**: `isRecord()`, `readNumber()`, `readString()`
  used consistently — no `as unknown as T` casts in adapter code.
- **Error classification**: `normalizeUnknownError` covers timeout, OOM, rate-
  limit, network, and generic — comprehensive and consistent across adapters.
- **Pure function design**: `extractClaimedIssueNumbers`, `mapComplexityFromLabels`,
  `normalizeLabels` are all pure, deterministic, and easy to test.
- **`Promise.allSettled` in `notifyProviders`**: Correct — one failing provider
  doesn't block others.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Naming & clarity | 20% | 9.8 |
| Consistency | 25% | 9.2 |
| Test coverage | 25% | 9.0 |
| Error handling | 20% | 9.5 |
| Style / formatting | 10% | 9.8 |
| **Weighted Total** | | **9.4 / 10** |

Delta from R6: **−0.2** — the `stdin: "ignore"` inconsistency is a systematic
gap in an otherwise thorough hardening pass; adapter test coverage remains weak.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | MEDIUM | Missing `stdin: "ignore"` (Claude + OpenCode `checkAvailability`) | NEW |
| 2 | MEDIUM | No Claude Code or OpenCode adapter tests | Carried (expanded) |
| 3 | LOW | Hardcoded "Codex CLI" in commit message | NEW |
| 4 | LOW | `parseJsonPayload` Codex/OpenCode duplication | NEW |
| 5 | LOW | Silent catch in `commitSandboxChanges` | Carried |
| 6 | COSMETIC | Extra blank line `opencode.adapter.ts:144` | NEW |

