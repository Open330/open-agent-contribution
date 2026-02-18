# End-User Experience Review — Round 6 — OAC v2026.5.0

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Wave 7 (exit codes, `oac r` alias, progress percentages, resettable counters)  
**Previous review**: `10-end-user-experience-review-r5.md` (Score: 9/10)

---

## 1. First Impression — 9.5/10 (up from 9/10)

Wave 7 nailed the top UX item I've been asking for: **progress percentages** (P2-2). During token estimation and task execution, spinners now show `(3/10 — 30%)` instead of just spinning. When processing a large repo with 50 tasks, the difference between "Estimating tokens..." (anxiety) and "Estimating tokens... (23/50 — 46%)" (confidence) is enormous.

The exit codes (P3-5) are properly documented in `oac run --help`:

```
Exit Codes:
  0   All tasks/epics completed successfully (or dry-run)
  1   Unexpected / unhandled error
  2   Configuration or validation error (bad flags, missing repo)
  3   All selected tasks/epics failed
  4   Partial success — some tasks succeeded, others failed
```

This is exactly what CI/CD needs. I can now write `if [ $? -eq 4 ]; then echo "Partial success"; fi` in my scripts.

And `oac r` (P3-1) — small thing but I'll use it 50 times a day. Muscle memory will thank me.

---

## 2. CLI Ergonomics Report — Improved

### Exit Codes — Finally Documented

Before Wave 7, `oac run` returned 0 or 1 with no documentation. Now there are 5 distinct codes, each meaningful:

| Code | Meaning | CI Use Case |
|------|---------|-------------|
| 0 | All tasks succeeded / dry-run | `set -e` compatible |
| 1 | Unexpected error | Alert on-call |
| 2 | Config/validation error | Fix pipeline config |
| 3 | All tasks failed | Agent issues, investigate |
| 4 | Partial success | Retry failed tasks |

The `ConfigError` class ensures that `--concurrency 0` or invalid `--mode` returns exit code 2 (not 1), so scripts can distinguish "bad config" from "runtime crash."

### Progress Percentages — The Missing Piece

| Operation | Before | After |
|-----------|--------|-------|
| Token estimation (task mode) | `Estimating tokens for 50 task(s)...` | `Estimating tokens... (23/50 — 46%)` |
| Task execution | `Executing tasks... (3/10)` | `Executing tasks... (3/10 — 30%)` |
| Epic token estimation | `Estimating tokens for 5 epic(s)...` | `Estimating epic tokens... (2/5 — 40%)` |
| Epic execution | *(no spinner)* | `Executing epics... (1/3 — 33%)` |

Every long operation now has a percentage. No more staring at a spinner wondering if it's stuck.

---

## 3. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅ — stable since R1)

| # | Issue | Status |
|---|-------|--------|
| P0-1 | Silent simulation fallback | ✅ Fixed (Wave 1) |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed (Wave 1) |
| P0-3 | No "Getting Started" in help | ✅ Fixed (Wave 1) |

### P1 — Painful (ALL RESOLVED ✅ — stable since R5)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P1-1 | Single-command pipeline | ✅ Fixed (Wave 6) | Stable |
| P1-2 | scan vs analyze confusion | ✅ Fixed (Wave 6) | Stable |
| P1-3 | Retry failed tasks | ✅ Fixed (Wave 4) | Stable |
| P1-4 | Usage examples in --help | ✅ Fixed (Wave 3) | Stable |
| P1-5 | Shell completion | ✅ Fixed (Wave 4) | Stable |
| P1-6 | run.ts monolith (contributor UX) | ✅ Fixed (Wave 5) | Stable |

### P2 — Annoying (3/6 RESOLVED — P2-2 fixed in Wave 7)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P2-1 | No `--quiet` flag | ✅ Fixed (Wave 3) | Stable |
| P2-2 | No progress percentages | ✅ Fixed (Wave 7) | Estimation + execution spinners show N/M — X% |
| P2-3 | Status watch mode flicker | ⚠️ Partial | SIGINT works, flicker remains |
| P2-4 | No config reference docs | ❌ Open | Users must read source |
| P2-5 | No changelog | ❌ Open | No CHANGELOG.md |
| P2-6 | Failed task details hidden | ✅ Fixed (Wave 3) | Stable |

### P3 — Polish (2/6 RESOLVED — P3-1, P3-5 fixed in Wave 7)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P3-1 | `oac r` alias | ✅ Fixed (Wave 7) | Power user shortcut |
| P3-2 | `oac init --minimal` | ❌ Open | Quick start without wizard |
| P3-3 | Colored diff in `--dry-run` | ❌ Open | Visual clarity |
| P3-4 | `oac explain <task-id>` | ❌ Open | Debug task selection |
| P3-5 | Exit code documentation | ✅ Fixed (Wave 7) | 5 distinct codes, documented in `--help` |
| P3-6 | Troubleshooting section | ❌ Open | Self-service for common issues |

---

## 4. Comparison Update

| Aspect | R1 | R2 | R3 | R4 | R5 | R6 | Benchmark |
|--------|-----|-----|-----|-----|-----|-----|-----------|
| `--help` examples | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| `--quiet` mode | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Getting Started | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Fail on missing prereqs | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Config types | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Shell completion | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Retry failed | ✗ | ✗ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Single-command flow | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✓ `gh pr create` |
| Failed task details | ✗ | ✅ | ✅ | ✅ | ✅ | ✅ | ✓ Standard |
| Modular codebase | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ | ✓ Maintainability |
| Progress percentages | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✓ `docker pull` |
| Documented exit codes | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✓ `gh`, `terraform` |

**12 of 12 baseline expectations met.**

---

## 5. Score Progression

| Round | Score | Key Change |
|-------|-------|------------|
| R1 | 5/10 | Initial audit — blocking onboarding issues |
| R2 | 7/10 | Wave 1-2 — config, help, getting started |
| R3 | 8/10 | Wave 3-4 — shell completion, quiet, retry |
| R4 | 8.5/10 | Wave 5 — contributor UX via decomposition |
| R5 | 9/10 | Wave 6 — single-command pipeline, scan/analyze clarity |
| **R6** | **9.5/10** | Wave 7 — progress %, exit codes, `oac r` alias |

---

## 6. Revised Prioritized Improvements

### P2 — Annoying (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P2-4 | Config reference docs | 1-2 hours | Auto-generate from Zod schema |
| P2-5 | CHANGELOG.md | 30 min | User trust on upgrades |

### P3 — Polish (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P3-2 | `oac init --minimal` | 1 hour | Quick start without wizard |
| P3-3 | Colored diff in `--dry-run` | 1-2 hours | Visual clarity |
| P3-4 | `oac explain <task-id>` | 2-3 hours | Debug task selection |
| P3-6 | Troubleshooting section | 1 hour | Self-service for common issues |

---

## 7. Final Verdict

**Would I keep using OAC?** — **Yes, it's become my daily driver.**

Wave 7 hit the exact items I said would push to 9.5: progress percentages and exit codes. The progress percentages during estimation and execution make large runs feel under control. The exit codes let me integrate OAC into my CI pipeline properly. And `oac r` is the kind of small touch that shows the maintainers care about power users.

**What pushed this to 9.5/10**: P2-2 (progress percentages) was the #1 remaining UX item. It's resolved. P3-5 (exit codes) with 5 distinct codes documented in `--help` is professional-grade CI integration. Combined with the `oac r` alias, Wave 7 resolved 3 items from my list in one pass.

**What would push to 10/10**: Auto-generated config reference docs (P2-4) and a CHANGELOG.md (P2-5). These are the last "expected from a mature CLI tool" items. Everything else is polish that most users won't notice.

**Score: 9.5/10** — Up from 9/10. All P0 and P1 resolved. 3 of 6 P2 items resolved. 2 of 6 P3 items resolved. The baseline comparison is at 12/12. The remaining items are quality-of-life polish for the last half-point.

