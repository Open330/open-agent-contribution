# End-User Experience Review — Round 2 — OAC v2026.4.2

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Waves 1–3 implementation  
**Previous review**: `02-end-user-experience-review.md` (Score: 5/10)

---

## 1. First Impression — 7/10 (up from 5/10)

Three things that were deal-breakers are now fixed:

**Silent simulation fallback — GONE.** This was the single worst UX decision. If you didn't have an agent CLI, OAC would silently fake execution results. Now it fails with an actionable error. Trust restored.

**Non-TypeScript `.ts` config — FIXED.** `oac init` now generates config using `defineConfig()` with proper TypeScript types. Your editor will give autocomplete and validation. This is how every modern tool does it (Vite, ESLint, Tailwind).

**"Getting Started" in help — ADDED.** Running `oac` now shows a clear 4-step getting started flow at the bottom of help output: init → doctor → analyze → run. A new user knows exactly what to do next.

The first 5 minutes went from "confused and possibly deceived" to "clear and functional." That's a meaningful improvement.

---

## 2. CLI Ergonomics Report — Improved

### Help Text — Now Has Examples ✅

Every command now includes usage examples via `.addHelpText("after", ...)`. For example, `oac run --help` shows:

```
Examples:
  $ oac run --repo owner/repo --tokens 50000
  $ oac run --repo owner/repo --provider codex
  $ oac run --dry-run
  $ oac run --source todo,lint
```

This is exactly what was missing. A user reading `--help` can now copy-paste an example and go. The examples cover the common cases (basic, with provider, dry-run, filtered).

### `--quiet` Flag — Added ✅

Global `--quiet` flag suppresses all non-error output. Combined with `--json`, this makes OAC scriptable. The implementation is clean: `suppressOutput = json || quiet` gates interactive output while keeping JSON and error output intact. Summary output still appears (correct — you always want to see what happened).

### Failed Task Details — Visible by Default ✅

After a run with partial failures, you now see:

```
Failed Tasks (2):
  ✗ Fix deprecation warning in auth module: ENOENT: ...
  ✗ Update test fixtures: Agent timed out after 120s
```

No more guessing what failed. No `--verbose` needed for the essential information.

### Still Missing

- **No `--quiet` suppression of summary**: The final summary still prints even with `--quiet`. This is a judgment call — I'd argue it's correct. The summary is the result, not noise.
- **No shell completion**: Still no `oac completion bash/zsh/fish`. Every mature CLI has this.
- **No command aliases**: Still can't `oac r` for `oac run`.
- **`scan` vs `analyze` still confusing**: Two commands with overlapping purposes, no clear guidance on which to use.

---

## 3. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P0-1 | Silent simulation fallback | ✅ Fixed | Simulation code removed entirely. No agent = fail fast |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed | `defineConfig()` wrapper with TypeScript types |
| P0-3 | No "Getting Started" in help | ✅ Fixed | Clear 4-step flow in root help output |

### P1 — Painful (1/5 RESOLVED)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P1-1 | 5-command pipeline | ❌ Open | Still requires init → doctor → scan/analyze → plan → run |
| P1-2 | `scan` vs `analyze` confusion | ❌ Open | Two overlapping commands, no clear differentiation |
| P1-3 | No retry for failed tasks | ❌ Open | Must re-run entire pipeline after partial failure |
| P1-4 | No usage examples in `--help` | ✅ Fixed | All 9 commands now have practical examples |
| P1-5 | No shell completion | ❌ Open | Still missing `oac completion` subcommand |

### P2 — Annoying (2/6 RESOLVED)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P2-1 | No `--quiet` flag | ✅ Fixed | Global flag, clean `suppressOutput` pattern |
| P2-2 | No ETA on long operations | ❌ Open | Spinners still show activity only, no progress % |
| P2-3 | Status watch mode improvements | ⚠️ Partial | SIGINT handler added (no more interval leak), but still uses `console.clear()` flicker |
| P2-4 | No config reference docs | ❌ Open | Users still must read source for all config options |
| P2-5 | No changelog | ❌ Open | No CHANGELOG.md |
| P2-6 | Failed task details hidden | ✅ Fixed | Failed tasks/epics show title + error in default output |

### P3 — Polish (0/6 RESOLVED)

All P3 items (aliases, cleanup command, CI docs, interactive plan, scanner naming, config validate) remain open.

---

## 4. Feedback & Output Quality — Improved

The output experience is noticeably better:

1. **Quiet mode works**: `oac run --quiet --json` produces clean JSON output only. `oac run --quiet` produces summary only. Correct for scripting.

2. **Failure visibility**: The failed task details section is the biggest practical improvement. Before, you'd see "2/5 failed" and have to add `--verbose` and re-run. Now the error reasons are right there.

3. **Help text is actionable**: Examples in every command's help mean less time reading docs. The getting started block at the root level is a clear on-ramp.

### Still Wanting

- **Progress percentages**: Long scans on big repos still show a spinner with no indication of progress. "Scanning... 2,847/10,000 files (28%)" would be reassuring.
- **Run duration**: The summary shows duration, but individual epic/task timing would help identify slow operations.

---

## 5. Workflow Friction Points — Reduced

### Friction Point 1: 5-Command Pipeline (STILL OPEN)

The biggest remaining friction. `oac run --repo owner/name` should handle the full pipeline. Individual commands should be for power users who want fine-grained control.

### Friction Point 2: scan vs analyze (STILL OPEN)

A new user still doesn't know which to use. At minimum, `oac --help` should explain when to use each.

### Friction Point 3: No Retry (STILL OPEN)

After partial failures, the user re-runs everything. Token waste, time waste.

### Friction Point 4: Simulation Fallback (RESOLVED ✅)

No longer an issue. The simulation code is removed entirely.

---

## 6. Comparison Update

| Aspect | Round 1 | Round 2 | Benchmark (`gh`/`docker`) |
|--------|---------|---------|---------------------------|
| `--help` examples | ✗ None | ✅ All 9 commands | ✓ Standard practice |
| `--quiet` mode | ✗ Missing | ✅ Global flag | ✓ Standard practice |
| Getting Started | ✗ No guidance | ✅ Root help block | ✓ Standard practice |
| Error on missing prereqs | ✗ Silent fake | ✅ Fail fast | ✓ Standard practice |
| Config types | ✗ Fake `.ts` | ✅ `defineConfig()` | ✓ Standard practice |
| Shell completion | ✗ Missing | ✗ Still missing | ✓ `gh`/`docker` have it |
| Single-command flow | ✗ 5 steps | ✗ Still 5 steps | ✓ `gh pr create` = 1 step |
| Failed task details | ✗ Hidden | ✅ Visible | ✓ Standard practice |

OAC has closed the gap on 5 of 8 baseline expectations. Shell completion and single-command flow remain the notable gaps vs mature CLIs.

---

## 7. Revised Prioritized Improvements

### P1 — Painful (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P1-1 | Single-command `oac run` pipeline | 4-6 hours | Biggest time-to-value improvement |
| P1-2 | Merge `scan`/`analyze` or clarify | 2-3 hours | Eliminates confusion |
| P1-3 | `oac run --retry-failed` | 3-4 hours | Saves tokens and time on partial failures |
| P1-5 | Shell completion | 2-3 hours | Table stakes for CLI tools |

### P2 — Annoying (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P2-2 | Progress percentages on long ops | 2-3 hours | Reduces anxiety on large repos |
| P2-4 | Config reference docs | 1-2 hours | Can auto-generate from Zod schema |
| P2-5 | CHANGELOG.md | 30 min | User trust on upgrades |

---

## 8. Final Verdict

**Would I keep using OAC?** — **Getting close.**

Round 1 was "Not yet" because the silent simulation fallback would have lost me on first run. That's gone. The tool is now honest about its requirements, helpful in its output, and scriptable with `--quiet`/`--json`.

The `--help` experience went from "what do I do" to "here's how." The failure reporting went from "something broke, figure it out" to "here's what broke and why." The config went from "fake TypeScript" to real TypeScript with autocomplete.

**What still holds me back**: The 5-command pipeline. I shouldn't have to run init → doctor → scan → plan → run as separate steps. `oac run --repo owner/name` should detect missing setup, scan, plan, and execute in one flow. Every minute I spend typing intermediate commands is a minute I'm not getting value from the tool.

**The one thing that would change "getting close" to "yes"**: Make `oac run --repo owner/name` work from a cold start — auto-init if needed, auto-scan, auto-plan, execute, report. One command, zero prerequisites beyond having an agent CLI installed. If that works, OAC earns a permanent alias in my shell config.

**Score: 7/10** — Up from 5/10. The P0 blockers are gone, the help system is genuinely useful, and the tool respects my time more than it did. The remaining gaps (pipeline friction, shell completion, retry) are P1-P2 items that would push this to an 8 or 9.

