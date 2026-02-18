# End-User Experience Review — Round 3 — OAC v2026.4.2

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Wave 4 (timeout, PQueue unification, shell completion, retry-failed)  
**Previous review**: `04-end-user-experience-review-r2.md` (Score: 7/10)

---

## 1. First Impression — 8/10 (up from 7/10)

Two of the four remaining P1 items are now resolved, and both directly address daily-use friction:

**Shell completion — ADDED.** `oac completion bash >> ~/.bashrc` — done. Covers all 10 subcommands and their options. Supports bash, zsh, and fish. This is table stakes for CLI tools and it's finally here. The generated scripts are static (no runtime eval), which is the correct approach.

**Retry failed tasks — ADDED.** `oac run --retry-failed` reads the most recent contribution log, filters failed tasks, and re-runs only those. No re-scanning, no re-estimating the full catalog, no wasting tokens on tasks that already succeeded. This is exactly what I asked for in Round 2.

The first-run experience hasn't changed (still good from Wave 3 fixes), but the daily-use experience is meaningfully better. I can now tab-complete commands and recover from partial failures without starting over.

---

## 2. CLI Ergonomics Report — Improved

### Shell Completion — Now Available ✅

```
$ oac completion bash >> ~/.bashrc
$ oac completion zsh >> ~/.zshrc
$ oac completion fish > ~/.config/fish/completions/oac.fish
```

The `oac completion --help` shows examples for all three shells. The generated scripts complete subcommands, global options (`--config`, `--verbose`, `--json`, `--quiet`, `--no-color`), and per-command options. This closes the gap with `gh`, `docker`, and `kubectl`.

### Retry Failed Tasks — Now Available ✅

```
$ oac run --repo owner/name --retry-failed
✔ Found 3 failed task(s) from run a1b2c3d4
[oac] Retrying 3 failed task(s) (budget: 50,000 tokens)
```

The flow is clean: reads the most recent log, shows how many failed tasks were found (with the run ID for traceability), then re-executes only those. Failed tasks get `priority: 100` so they're selected first within the budget. The help text includes a retry example.

### Updated Help Text

`oac run --help` now includes:
```
  $ oac run --retry-failed                Re-run only failed tasks from last run
```

Good — the example is practical and self-explanatory.

### Still Missing

- **`scan` vs `analyze` still confusing**: Two overlapping commands, no clear guidance. This is now the oldest open P1 item.
- **No single-command pipeline**: Still requires multiple steps for first-time use. `oac run --repo` from cold start still needs prior init/doctor/scan.
- **No command aliases**: Still can't `oac r` for `oac run`.

---

## 3. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅ — unchanged from R2)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P0-1 | Silent simulation fallback | ✅ Fixed (Wave 1) | Stable |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed (Wave 1) | Stable |
| P0-3 | No "Getting Started" in help | ✅ Fixed (Wave 1) | Stable |

### P1 — Painful (3/5 RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P1-1 | 5-command pipeline | ❌ Open | Still requires init → doctor → scan/analyze → plan → run |
| P1-2 | `scan` vs `analyze` confusion | ❌ Open | Two overlapping commands, no clear differentiation |
| P1-3 | No retry for failed tasks | ✅ Fixed (Wave 4) | `--retry-failed` reads most recent log, retries only failed tasks |
| P1-4 | No usage examples in `--help` | ✅ Fixed (Wave 3) | Stable |
| P1-5 | No shell completion | ✅ Fixed (Wave 4) | `oac completion bash/zsh/fish` with full option coverage |

### P2 — Annoying (2/6 RESOLVED — unchanged from R2)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P2-1 | No `--quiet` flag | ✅ Fixed (Wave 3) | Stable |
| P2-2 | No ETA on long operations | ❌ Open | Spinners still show activity only |
| P2-3 | Status watch mode flicker | ⚠️ Partial | SIGINT handler works, `console.clear()` flicker remains |
| P2-4 | No config reference docs | ❌ Open | Users must read source for config options |
| P2-5 | No changelog | ❌ Open | No CHANGELOG.md |
| P2-6 | Failed task details hidden | ✅ Fixed (Wave 3) | Stable |

### P3 — Polish (0/6 RESOLVED — unchanged)

All P3 items remain open.

---

## 4. Comparison Update

| Aspect | R1 | R2 | R3 | Benchmark (`gh`/`docker`) |
|--------|-----|-----|-----|---------------------------|
| `--help` examples | ✗ | ✅ | ✅ | ✓ Standard |
| `--quiet` mode | ✗ | ✅ | ✅ | ✓ Standard |
| Getting Started | ✗ | ✅ | ✅ | ✓ Standard |
| Fail on missing prereqs | ✗ | ✅ | ✅ | ✓ Standard |
| Config types | ✗ | ✅ | ✅ | ✓ Standard |
| Shell completion | ✗ | ✗ | ✅ | ✓ Standard |
| Retry failed | ✗ | ✗ | ✅ | ✓ `terraform apply` has it |
| Single-command flow | ✗ | ✗ | ✗ | ✓ `gh pr create` = 1 step |
| Failed task details | ✗ | ✅ | ✅ | ✓ Standard |

OAC has closed the gap on 7 of 9 baseline expectations. The single-command flow remains the most notable gap.

---

## 5. Revised Prioritized Improvements

### P1 — Painful (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P1-1 | Single-command `oac run` pipeline | 4-6 hours | Biggest time-to-value improvement — make `run` auto-detect and handle init/scan/plan |
| P1-2 | Merge `scan`/`analyze` or clarify | 2-3 hours | Eliminates the oldest open confusion point |

### P2 — Annoying (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P2-2 | Progress percentages on long ops | 2-3 hours | Reduces anxiety on large repos |
| P2-4 | Config reference docs | 1-2 hours | Auto-generate from Zod schema |
| P2-5 | CHANGELOG.md | 30 min | User trust on upgrades |

---

## 6. Final Verdict

**Would I keep using OAC?** — **Yes, with caveats.**

This crossed the line from "getting close" to "I'll keep it installed." The two additions that made the difference:

1. **Shell completion** means I stop typing `oac` + space + think. Tab-complete handles it. This is the kind of small thing that determines whether a tool feels native or bolted-on.

2. **`--retry-failed`** means partial failures don't cost me a full re-run. In practice, if 2 out of 5 tasks fail because of a transient API issue, I run `oac run --retry-failed` and only those 2 tasks re-execute. Tokens saved, time saved, frustration avoided.

**What still bothers me**: The multi-step pipeline. I still wish `oac run --repo owner/name` would just work from zero state — auto-init, auto-scan, auto-plan, execute. Having to run `init`, `doctor`, `scan/analyze`, then `run` as separate steps feels like 2020-era CLI design. Modern tools handle this seamlessly.

**What would push this to 9/10**: Make `oac run` the single entry point that handles everything. If the repo isn't initialized, init it. If there's no scan data, scan. If there's no plan, plan. Just run. Also clarify or merge `scan` vs `analyze` — after 4 waves of improvements, this is now the oldest unresolved confusion.

**Score: 8/10** — Up from 7/10. Shell completion and retry-failed resolve two of the four remaining P1 friction points. The tool now meets 7 of 9 baseline expectations for mature CLI tools. The remaining gap — single-command pipeline flow — is the difference between "a good tool I use" and "a tool I evangelize."

