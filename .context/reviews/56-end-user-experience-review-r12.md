# End-User Experience Review — Round 12

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Power User / Developer Advocate |
| **Round** | 12 |
| **Version** | `2026.221.2` |
| **Date** | 2026-02-21 |
| **Scope** | CLI UX, error messages, progress feedback, PR output quality |
| **Previous Score** | 9.9 / 10 (R11) |

---

## Executive Summary

Two changes since R11 improve the user experience:

1. **`issueLabels` now works** — the config option that was silently ignored now
   correctly filters issues, meaning `oac run` no longer discovers irrelevant
   issues (e.g. spam, off-topic) when the user has configured labels.  This was
   a **trust-breaking bug** — users who set `issueLabels: ["documentation"]`
   expected it to work and saw it ignored.

2. **CI is green** — while not user-facing directly, a green CI badge on the
   README signals project health.  Users evaluating the tool check CI status.

The "Codex CLI" misattribution in commit messages and the silent PR failure
issue remain.

---

## 1. `issueLabels` Config Now Works (POSITIVE — fixes trust issue)

Before `bb094c9`, this config:

```ts
export default defineConfig({
  discovery: { issueLabels: ["documentation", "good first issue"] },
});
```

…was completely ignored.  All open issues were discovered regardless.  For a
tool that creates PRs against real repositories, **scanning the wrong issues is
actively harmful** — it wastes tokens and creates unwanted PRs.

The fix correctly filters at discovery time.  Users who had given up on this
option can now rely on it.  From a UX perspective, this is a **P0 fix** — a
config option that silently does nothing erodes user trust faster than a missing
feature.

---

## 2. Hardcoded "Codex CLI" in Commit/PR Attribution (LOW — carried)

PR bodies and commit messages still say "Codex CLI" regardless of which provider
was actually used.  A maintainer reviewing an OAC-generated PR sees incorrect
attribution — confusing but not harmful.

---

## 3. Silent PR Creation Failure (LOW — carried)

When PR creation fails, the final summary shows `PRs created: 0` but doesn't
explain *why* the PR wasn't created when execution succeeded.  A `prSkipReason`
would help users understand whether it was a duplicate, a GitHub API error, or
a permissions issue.

---

## 4. Progress Spinner Flicker (COSMETIC — carried)

Rapid spinner updates on fast terminals.  No debounce added.

---

## 5. Biome Lint Sweep — Indirect UX Impact (POSITIVE)

While users don't see lint errors, the 59 auto-fixes reduce the chance of
future regressions that could produce broken builds or inconsistent behavior.
A healthy codebase means fewer bugs that reach users.

The green CI badge is now trustworthy — users can install with confidence that
the latest version passes all checks.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Feedback quality | 30% | 9.8 |
| Error guidance | 25% | 10 |
| Output formatting | 20% | 10 |
| Correctness of UX claims | 15% | 10 |
| Accessibility | 10% | 10 |
| **Weighted Total** | | **9.9 / 10** |

Delta from R11: **±0.0** — the `issueLabels` fix improves "Correctness of UX
claims" from 9.5 to 10 (config does what it says), but the overall weighted
score remains 9.9 due to the carried "Codex CLI" misattribution.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | LOW | Hardcoded "Codex CLI" in commit message | Carried |
| 2 | LOW | Silent PR creation failure — no `prSkipReason` | Carried |
| 3 | COSMETIC | Progress spinner flicker | Carried |

