# End-User Experience Review — Round 5 — OAC v2026.5.0

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Wave 6 (single-command pipeline + scan/analyze clarification)  
**Previous review**: `08-end-user-experience-review-r4.md` (Score: 8.5/10)

---

## 1. First Impression — 9/10 (up from 8.5/10)

Wave 6 directly addressed the two issues I've been flagging since Round 1:

**P1-1 (single-command pipeline)**: `oac run --repo owner/repo` is now clearly positioned as the primary entry point. The `--help` text says it plainly: *"Run the full OAC pipeline — analyze, plan, and execute in one command."* The after-help text explains that no separate scan/analyze step is needed. And if someone runs `oac run` without `--repo` and no config, the error message now guides them:

```
No repository specified.

  Quick start:  oac run --repo owner/repo
  With config:  oac init   (creates oac.config.ts, then just run `oac run`)
```

This is what I wanted since Round 1. The 5-step pipeline is now a 1-step pipeline for the common case.

**P1-2 (scan vs analyze clarity)**: The descriptions are now distinct and cross-referenced:
- `scan`: *"Quick task discovery — list individual issues ranked by priority"*
- `analyze`: *"Deep codebase analysis — build module graph and group findings into epics"*

Both commands explain when to use the other. The `analyze` help text even notes that `oac run` auto-analyzes, so you usually don't need `analyze` directly. The confusion that survived 4 rounds is resolved.

---

## 2. CLI Ergonomics Report — Improved

The `oac --help` output now tells a coherent story:

| Command | Description | Clear? |
|---------|-------------|--------|
| `init` | Initialize OAC in the current directory | ✅ |
| `scan` | Quick task discovery — list individual issues ranked by priority | ✅ Clear purpose |
| `analyze` | Deep codebase analysis — build module graph and group findings into epics | ✅ Distinct from scan |
| `run` | Run the full OAC pipeline — analyze, plan, and execute in one command | ✅ Obviously the main command |
| `plan` | Build an execution plan | ✅ |
| `doctor` | Check environment health | ✅ |

A new user reading this list would immediately know: start with `run`, use `scan` for quick exploration, use `analyze` for deep inspection. That wasn't true before Wave 6.

The `init` command now points users to `oac run` instead of `oac scan`, which matches the new mental model.

---

## 3. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅ — stable since R1)

| # | Issue | Status |
|---|-------|--------|
| P0-1 | Silent simulation fallback | ✅ Fixed (Wave 1) |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed (Wave 1) |
| P0-3 | No "Getting Started" in help | ✅ Fixed (Wave 1) |

### P1 — Painful (6/6 RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P1-1 | 5-command pipeline → single command | ✅ Fixed (Wave 6) | `oac run --repo` is the primary entry point. Help text, error messages, and cross-references all guide users there |
| P1-2 | `scan` vs `analyze` confusion | ✅ Fixed (Wave 6) | Distinct descriptions, cross-references in help text, `run` explains auto-analyze |
| P1-3 | No retry for failed tasks | ✅ Fixed (Wave 4) | Stable |
| P1-4 | No usage examples in `--help` | ✅ Fixed (Wave 3) | Stable |
| P1-5 | No shell completion | ✅ Fixed (Wave 4) | Stable |
| P1-6 | `run.ts` monolith (contributor UX) | ✅ Fixed (Wave 5) | Stable |

### P2 — Annoying (2/6 RESOLVED — unchanged from R3)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P2-1 | No `--quiet` flag | ✅ Fixed (Wave 3) | Stable |
| P2-2 | No ETA on long operations | ❌ Open | Spinners still show activity only |
| P2-3 | Status watch mode flicker | ⚠️ Partial | SIGINT works, flicker remains |
| P2-4 | No config reference docs | ❌ Open | Users must read source |
| P2-5 | No changelog | ❌ Open | No CHANGELOG.md |
| P2-6 | Failed task details hidden | ✅ Fixed (Wave 3) | Stable |

### P3 — Polish (0/6 RESOLVED — unchanged)

All P3 items remain open.

---

## 4. Comparison Update

| Aspect | R1 | R2 | R3 | R4 | R5 | Benchmark |
|--------|-----|-----|-----|-----|-----|-----------|
| `--help` examples | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| `--quiet` mode | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Getting Started | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Fail on missing prereqs | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Config types | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Shell completion | ✗ | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Retry failed | ✗ | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Single-command flow | ✗ | ✗ | ✗ | ✗ | ✅ | ✓ `gh pr create` |
| Failed task details | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Modular codebase | ✗ | ✗ | ✗ | ✅ | ✅ | ✓ Maintainability |

**10 of 10 baseline expectations met.**

---

## 5. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 5/10 | Initial audit — blocking onboarding issues |
| R2 | 7/10 | Wave 1-2 — config, help, getting started |
| R3 | 8/10 | Wave 3-4 — shell completion, quiet, retry |
| R4 | 8.5/10 | Wave 5 — contributor UX via decomposition |
| **R5** | **9/10** | Wave 6 — single-command pipeline, scan/analyze clarity |

---

## 6. Revised Prioritized Improvements

### P2 — Annoying (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P2-2 | Progress percentages on long ops | 2-3 hours | Reduces anxiety on large repos |
| P2-4 | Config reference docs | 1-2 hours | Auto-generate from Zod schema |
| P2-5 | CHANGELOG.md | 30 min | User trust on upgrades |

### P3 — Polish (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P3-1 | `oac run` alias (`oac r`) | 15 min | Power users save keystrokes |
| P3-2 | Config scaffold in `oac init --minimal` | 1 hour | Quick start without wizard |
| P3-3 | Colored diff in `--dry-run` output | 1-2 hours | Visual clarity |
| P3-4 | `oac explain <task-id>` | 2-3 hours | Debug why a task was selected |
| P3-5 | Exit code documentation | 30 min | CI/CD integration |
| P3-6 | Troubleshooting section in README | 1 hour | Self-service for common issues |

---

## 7. Final Verdict

**Would I keep using OAC?** — **Yes, absolutely.**

The tool now has a clear story: `oac run --repo owner/repo` does everything. If I want to peek before committing, `oac scan` gives me a quick list. If I want the full context, `oac analyze` builds it. The commands don't overlap conceptually anymore — each has a clear purpose that's explained in `--help`.

**What pushed this to 9/10**: P1-1 and P1-2 were the two items I've flagged every round. They're resolved. All P0 and P1 items are now closed. The baseline comparison hits 10/10. The remaining items (P2, P3) are quality-of-life improvements, not barriers to adoption.

**What would push to 9.5 or 10/10**: Progress percentages (P2-2) and auto-generated config docs (P2-4). These are the "last 10%" polish items that separate "good CLI tool" from "delightful CLI tool." A changelog (P2-5) would also help — I want to know what's new before upgrading.

**Score: 9/10** — Up from 8.5/10. All P0 and P1 items resolved. The user journey from install to first PR is now smooth and well-guided. The remaining friction is P2/P3 polish.

