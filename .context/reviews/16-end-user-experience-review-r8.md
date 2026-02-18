# End-User Experience Review — Round 8 — OAC v2026.4.2

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Wave 9 (final P3/T3 polish)  
**Previous review**: `14-end-user-experience-review-r7.md` (Score: 10/10)

---

## 1. First Impression — 10/10 (unchanged)

Wave 9 delivered all 4 remaining P3 items and 2 T3 items. The UX was already at 10/10 after Wave 8 — these are bonus polish that push beyond the baseline. Let me evaluate each.

### P3-2: `oac init --minimal` — ✅ Excellent

The two-track init is exactly right:
- **Interactive** (`oac init`): Full wizard for first-timers. Unchanged, still works.
- **Minimal** (`oac init --minimal --repo owner/repo`): Generates a config in one shot. Defaults to claude-code provider, 100K token budget. No prompts.

This is what I'd use in CI/CD or when onboarding a new repo quickly. The `--repo` flag is required with `--minimal` — good guard against generating a useless config. The help text shows both paths clearly.

### P3-3: Colored Diff in `--dry-run` — ✅ Nice touch

`--dry-run` now shows a colored pseudo-diff for each task:
- Green `+` for the task title
- Yellow `~` for target files
- Complexity color-coded (green/yellow/red)
- Dim description preview

Before this, `--dry-run` output was plain text and hard to scan. The colored output makes it much easier to visually parse what would be executed. Small change, real impact on the "should I actually run this?" decision.

### P3-4: `oac explain <id>` — ✅ Solves a real gap

When the analyzer selects a task I don't expect, I used to dig through the quality report JSON. Now:

```bash
oac explain "unused-export-in-utils"
```

Shows the source scanner, severity, complexity, target file, line number, and what the agent would do. If the ID doesn't match, it lists available findings and epics. This is the debugging tool I needed for understanding task selection.

### P3-6: Troubleshooting Section — ✅ Complete

Five collapsible FAQ entries covering the issues I'd actually hit:
1. Agent not found → `oac doctor`
2. Token budget exceeded → `--dry-run` + budget config
3. Config errors → `oac doctor` + `--minimal`
4. GitHub auth → `gh auth status`
5. Worktree errors → `git worktree prune`

All with concrete commands to run. Collapsible `<details>` tags keep the README clean. Positioned before Philosophy — right where I'd look.

---

## 2. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅)

| # | Issue | Status |
|---|-------|--------|
| P0-1 | Silent simulation fallback | ✅ Fixed (Wave 1) |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed (Wave 1) |
| P0-3 | No "Getting Started" in help | ✅ Fixed (Wave 1) |

### P1 — Painful (ALL RESOLVED ✅)

| # | Issue | Status |
|---|-------|--------|
| P1-1 | Single-command pipeline | ✅ Fixed (Wave 6) |
| P1-2 | scan vs analyze confusion | ✅ Fixed (Wave 6) |
| P1-3 | Retry failed tasks | ✅ Fixed (Wave 4) |
| P1-4 | Usage examples in --help | ✅ Fixed (Wave 3) |
| P1-5 | Shell completion | ✅ Fixed (Wave 4) |
| P1-6 | run.ts monolith (contributor UX) | ✅ Fixed (Wave 5) |

### P2 — Annoying (5/6 RESOLVED — unchanged)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P2-1 | No `--quiet` flag | ✅ Fixed (Wave 3) | Stable |
| P2-2 | No progress percentages | ✅ Fixed (Wave 7) | Stable |
| P2-3 | Status watch mode flicker | ⚠️ Partial | SIGINT works, flicker remains |
| P2-4 | No config reference docs | ✅ Fixed (Wave 8) | Stable |
| P2-5 | No changelog | ✅ Fixed (Wave 8) | Stable |
| P2-6 | Failed task details hidden | ✅ Fixed (Wave 3) | Stable |

### P3 — Polish (ALL RESOLVED ✅ — 4 items fixed in Wave 9)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P3-1 | `oac r` alias | ✅ Fixed (Wave 7) | Stable |
| P3-2 | `oac init --minimal` | ✅ Fixed (Wave 9) | `--minimal --repo` quick start |
| P3-3 | Colored diff in `--dry-run` | ✅ Fixed (Wave 9) | Colored pseudo-diff output |
| P3-4 | `oac explain <task-id>` | ✅ Fixed (Wave 9) | Debug task selection |
| P3-5 | Exit code documentation | ✅ Fixed (Wave 7) | Stable |
| P3-6 | Troubleshooting section | ✅ Fixed (Wave 9) | 5 collapsible FAQ entries |

---

## 3. Comparison Update

| Aspect | R1 | R7 | R8 | Benchmark |
|--------|-----|-----|-----|-----------|
| `--help` examples | ✗ | ✅ | ✅ | ✓ Standard |
| `--quiet` mode | ✗ | ✅ | ✅ | ✓ Standard |
| Getting Started | ✗ | ✅ | ✅ | ✓ Standard |
| Config types | ✗ | ✅ | ✅ | ✓ Standard |
| Shell completion | ✗ | ✅ | ✅ | ✓ Standard |
| Retry failed | ✗ | ✅ | ✅ | ✓ Standard |
| Single-command flow | ✗ | ✅ | ✅ | ✓ `gh pr create` |
| Progress percentages | ✗ | ✅ | ✅ | ✓ `docker pull` |
| Documented exit codes | ✗ | ✅ | ✅ | ✓ `gh`, `terraform` |
| Config reference docs | ✗ | ✅ | ✅ | ✓ `eslint`, `prettier` |
| CHANGELOG | ✗ | ✅ | ✅ | ✓ Standard |
| Modular codebase | ✗ | ✅ | ✅ | ✓ Maintainability |
| Quick init (`--minimal`) | ✗ | ✗ | ✅ | ✓ `eslint --init` |
| Task debugging | ✗ | ✗ | ✅ | ✓ `terraform plan` |
| Troubleshooting docs | ✗ | ✗ | ✅ | ✓ Standard |

**15 of 15 expectations met.** Three bonus items added in Wave 9.

---

## 4. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 5/10 | Initial audit — blocking onboarding issues |
| R2 | 7/10 | Wave 1-2 — config, help, getting started |
| R3 | 8/10 | Wave 3-4 — shell completion, quiet, retry |
| R4 | 8.5/10 | Wave 5 — contributor UX via decomposition |
| R5 | 9/10 | Wave 6 — single-command pipeline |
| R6 | 9.5/10 | Wave 7 — progress %, exit codes, `oac r` alias |
| R7 | 10/10 | Wave 8 — config reference docs, CHANGELOG |
| **R8** | **10/10** | Wave 9 — all P3 items resolved, troubleshooting |

---

## 5. Final Verdict

**Score: 10/10** — Unchanged. Already at ceiling.

Wave 9 closed every remaining P3 item. The only open issue across all tiers is P2-3 (status watch flicker) — a cosmetic edge case that doesn't affect the core workflow.

**Total resolution**: 20/21 issues resolved across P0–P3. The one remaining (P2-3) is marked partial and doesn't block any workflow.

**From 5/10 to 10/10 in 9 waves.** This is a complete, well-documented, user-friendly CLI tool. I would recommend OAC to any colleague maintaining open source projects — without caveats, without asterisks.

