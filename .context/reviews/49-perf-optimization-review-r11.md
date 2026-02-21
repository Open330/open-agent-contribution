# Performance Optimization Review — Round 11

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Systems Performance Engineer |
| **Round** | 11 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — hot paths, allocation patterns, I/O scheduling |
| **Previous Score** | 9.5 / 10 (R10) |

---

## Executive Summary

No regressions.  R11 performs a **code-weight analysis** of the cross-adapter
duplication from a performance-engineering perspective and examines the
**module-load cost** of the adapter registry's eager imports.

---

## 1. Duplication as Dead Weight (INFO)

The ~220 lines of duplicated functions across three adapters are not a runtime
performance issue — JavaScript JIT compiles each function once per isolate
regardless of source-level duplication.  However, they affect:

- **Bundle size**: ~220 lines × ~40 bytes/line ≈ 8.8 KB of dead duplication in
  the published package.  Negligible for a CLI tool.
- **Parse time**: V8 parses ~1 MB/ms.  8.8 KB ≈ 9 µs.  Immeasurable.
- **Maintenance cost** (non-perf): A drift in `parseTokenPatchFromPayload`
  between adapters could silently mis-report token counts, which would impact
  budget planning accuracy — an indirect performance concern.

**Verdict**: No runtime impact.  The architectural case for extraction is stronger
than the perf case.

---

## 2. Registry Eager Imports (INFO)

`registry.ts` imports all three adapter modules at the top level:

```ts
import { ClaudeCodeAdapter } from "./claude-code.adapter.js";
import { CodexAdapter } from "./codex.adapter.js";
import { OpenCodeAdapter } from "./opencode.adapter.js";
```

All three modules are parsed and their top-level code executed even if only one
adapter is used.  Cost:

| Module | Lines | Est. parse time |
|--------|------:|----------------:|
| `claude-code.adapter.ts` | 552 | ~22 µs |
| `codex.adapter.ts` | 608 | ~24 µs |
| `opencode.adapter.ts` | 469 | ~19 µs |
| **Total** | 1 629 | ~65 µs |

At 65 µs, lazy-loading would save nothing meaningful.  The factory pattern
already defers *instantiation* — only the module parse is eager.

---

## 3. `estimateContextTokens` Sequential I/O (LOW — carried)

Detailed in Performance R7.  The sequential `stat()` loop adds ≤50 ms even at
100 files.  A `Promise.all` rewrite is trivial but not urgent.

---

## 4. `AsyncEventQueue` Allocation Pattern (INFO)

Each `push()` call either resolves an existing promise (O(1), no allocation) or
appends to the `values` array (amortized O(1)).  The `resolvers` array grows
only when consumers are faster than producers — unlikely during agent execution
since events arrive at 1–10 Hz.

Memory: A typical run produces <500 events × ~200 bytes = ~100 KB.  The queue
is flushed on `close()`, allowing GC.

---

## 5. `JSON.parse` on Every stdout Line (INFO)

All adapters call `JSON.parse()` on every stdout line.  Non-JSON lines throw
(caught by bare `catch {}`).  V8 optimises `try/catch` well; the throw path
costs ~5–10 µs per line.  For a typical agent run with 50–200 non-JSON lines,
total overhead is ~0.2–2 ms.  Not actionable.

---

## 6. `PQueue` Internal Overhead (INFO)

`PQueue` uses a priority queue internally (binary heap).  For OAC's workload
(1–20 tasks), the heap overhead is O(n log n) where n ≤ 20 — effectively O(1).
The library adds ~15 KB to the bundle.  No concern.

---

## Optimization Opportunities (if ever needed)

| Opportunity | Estimated Gain | Effort | Priority |
|-------------|----------------|--------|----------|
| `Promise.all` for `estimateContextTokens` | ~40 ms at 100 files | Trivial | LOW |
| Lazy adapter imports | ~65 µs startup | Low | NONE |
| Pre-check JSON line prefix before `JSON.parse` | ~1 ms per run | Trivial | NONE |
| Shared `readline` options object | ~0 | Trivial | NONE |

None of these are worth implementing unless profiling reveals a real bottleneck.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Hot-path efficiency | 35% | 9.5 |
| Memory / allocation | 25% | 10 |
| I/O scheduling | 25% | 9.5 |
| Startup time | 15% | 10 |
| **Weighted Total** | | **9.6 / 10** |

Delta from R10: **+0.1** — deeper analysis confirms no hidden costs; the
architecture is well-optimised for its workload profile.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | LOW | Sequential `stat()` in `estimateContextTokens` | Carried |
| 2 | INFO | Duplication is dead weight, not runtime perf | NEW |
| 3 | INFO | Registry eager imports — 65 µs, not worth lazy-loading | NEW |
| 4 | INFO | `AsyncEventQueue` allocation pattern — efficient | NEW |

