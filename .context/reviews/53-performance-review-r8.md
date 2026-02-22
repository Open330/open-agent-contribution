# Performance Review — Round 8

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Senior Performance Engineer |
| **Round** | 8 |
| **Version** | `2026.221.2` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — 31 modules, ~4 800 LoC production |
| **Previous Score** | 9.6 / 10 (R7) |

---

## Executive Summary

No performance-relevant changes since R7.  The `issueLabels` filtering adds a
negligible `Array.filter()` pass over already-fetched issues (< 0.1 ms for
typical issue counts).  The Biome auto-fixes are purely cosmetic — import
reordering and formatting changes produce identical V8 bytecode.  All findings
from R7 carry forward.

---

## 1. `issueLabels` Filter Cost (INFO)

The new `matchesLabelFilter()` is called once per issue during discovery:

```ts
issues.filter(issue => matchesLabelFilter(issue, issueLabels))
```

- Creates a `Set` from `allowedLabels` (O(k) where k = label count, typically 1-3)
- Iterates issue labels (O(m) where m = labels per issue, typically 1-5)
- For 100 issues × 5 labels each: ~500 comparisons → < 0.05 ms

The `Set` is re-created per issue call.  For maximum pedantry, it could be
hoisted outside the filter, but the cost is noise-level.

---

## 2. Sequential `stat()` in `estimateContextTokens` (LOW — carried)

Both Codex and OpenCode adapters iterate target files sequentially.  ~50 ms at
100 files.  No change.

---

## 3. `PQueue` Dual-Concurrency Model (INFO — reaffirmed)

Two `PQueue` instances for execution and completion remain correctly calibrated.
No change since R7.

---

## 4. npx Cold-Start (INFO — carried)

First-invocation penalty for `npx --yes @openai/codex` remains ~2-5 s.  No
change.

---

## 5. Status Spinner Flicker (COSMETIC — carried)

No debounce added.  Unchanged.

---

## 6. `pnpm.overrides` Impact (INFO)

The `minimatch@>=10.2.1` override changes the resolved version of a transitive
dependency.  `minimatch` is used only in `glob` (development-time), not on any
runtime hot path.  Zero runtime performance impact.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Hot-path efficiency | 30% | 9.5 |
| Concurrency model | 25% | 9.5 |
| I/O patterns | 25% | 9.5 |
| Resource cleanup | 20% | 10 |
| **Weighted Total** | | **9.6 / 10** |

Delta from R7: **±0.0** — no performance-relevant changes.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | LOW | Sequential `stat()` in `estimateContextTokens` | Carried |
| 2 | INFO | `issueLabels` filter cost — negligible | NEW |
| 3 | INFO | npx cold-start ~2-5 s first run | Carried |
| 4 | COSMETIC | Status spinner flicker | Carried |

