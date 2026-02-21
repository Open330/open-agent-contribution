# End-User Experience Review — Round 11

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Power User / Developer Advocate |
| **Round** | 11 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | CLI UX, error messages, progress feedback, PR output quality |
| **Previous Score** | 10 / 10 (R10) |

---

## Executive Summary

UX remains excellent.  R11 surfaces one **user-visible bug** — the hardcoded
"Codex CLI" attribution in commit messages regardless of the actual provider —
and evaluates the **dry-run output** quality.

---

## 1. Hardcoded "Codex CLI" in Commit Attribution (LOW)

When OAC commits sandbox changes, the commit message reads:

```
[OAC] Fix typo in README

Automated contribution by OAC using Codex CLI.
```

This appears even when the user selected Claude Code or OpenCode.  For open-
source maintainers reviewing the PR, this misattribution is confusing.  The
provider name should come from `adapter.name`.

**User impact**: Moderate — PR reviewers see incorrect tool attribution.
**Fix complexity**: Low — thread `adapter.name` through to `commitSandboxChanges`.

---

## 2. Dry-Run Output Quality (POSITIVE)

The `renderDryRunDiff` function (task.ts lines 153–192) provides a git-diff-
style preview:

```
+ Fix typo in README
  source: github issue  complexity: simple
  ~ README.md
  Brief description of the change...
```

This is clean, scannable, and uses colour coding effectively.  The `+` prefix
for selected tasks and `~` for target files mirrors git conventions.

---

## 3. Failed Task Surface (POSITIVE)

`printFinalSummary` (lines 330–339) proactively surfaces failed tasks with
truncated error messages — users don't need `--verbose` to understand what went
wrong.  This is a strong UX pattern.

---

## 4. Doctor Command Output (POSITIVE)

`oac doctor` provides a clear table with `[OK]`, `[!]`, `[X]` status indicators,
version numbers, and actionable fix instructions.  The Codex npx fallback check
correctly warns when the bare binary exists but the npm package is needed.

---

## 5. Progress Spinner Feedback (LOW — cosmetic, carried)

The execution spinner updates on every completed task with percentage:

```
Executing tasks... (3/5 — 60%)
```

On fast terminals with many tasks, the rapid updates can flicker.  A 100 ms
debounce would smooth this without reducing informativeness.

---

## 6. PR Body Quality (POSITIVE)

The generated PR body includes:

- Summary section with task description
- `Closes #N` for auto-linking
- Context section with source, complexity, tokens used, files changed
- OAC attribution link

This is comprehensive and follows GitHub conventions.  PR reviewers get all the
context they need without clicking through.

---

## 7. Error Message Clarity (POSITIVE)

The `resolveAdapter` function provides actionable error messages:

```
Unknown provider "gpt-4". Supported providers: claude-code, codex, opencode.
Run `oac doctor` to check your environment setup.
```

And for unavailable adapters:

```
Agent CLI "codex" is not available: Codex CLI is not available.
Install the codex CLI or switch providers.
Run `oac doctor` for setup instructions.
```

Both guide the user to the next action.

---

## 8. Silent PR Creation Failure (LOW)

`createPullRequest` in `pr.ts` catches all errors and returns `undefined`:

```ts
} catch (error) {
  console.warn(`[oac] PR creation failed: ${message}`);
  return undefined;
}
```

The `console.warn` is visible but easy to miss in verbose output.  The final
summary shows `PRs created: 0` but doesn't explicitly flag *why* a PR wasn't
created when execution succeeded.  A `TaskRunResult` could carry a `prSkipReason`
field.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Feedback quality | 30% | 9.8 |
| Error guidance | 25% | 10 |
| Output formatting | 20% | 10 |
| Correctness of UX claims | 15% | 9.5 |
| Accessibility | 10% | 10 |
| **Weighted Total** | | **9.9 / 10** |

Delta from R10: **−0.1** — the "Codex CLI" misattribution is a minor but
user-visible bug that slightly dents the otherwise flawless UX.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | LOW | Hardcoded "Codex CLI" in commit message | NEW |
| 2 | LOW | Silent PR creation failure — no `prSkipReason` | NEW |
| 3 | COSMETIC | Progress spinner flicker | Carried |

