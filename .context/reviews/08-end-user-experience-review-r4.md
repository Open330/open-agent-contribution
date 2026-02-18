# End-User Experience Review — Round 4 — OAC v2026.5.0

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: Re-evaluation after Wave 5 (run.ts monolith decomposition into run/ directory)  
**Previous review**: `06-end-user-experience-review-r3.md` (Score: 8/10)

---

## 1. First Impression — 8.5/10 (up from 8/10)

Wave 5 was an internal refactoring — no new user-facing features. But it matters to me as a user in two indirect ways:

1. **The tool is now easier to contribute to.** I opened `src/cli/commands/run.ts` after Wave 4 and saw 1,691 lines. My first thought: "I'm not touching this." Now it's 8 files in `run/`, the largest being 547 lines. If I want to fix a bug in PR creation, I open `pr.ts` (105 lines). If I want to understand the retry flow, I open `retry.ts` (142 lines). This lowers my barrier to contributing fixes or features.

2. **Future features will be better scoped.** Every previous wave added functionality to the same monolith. Now there are clear module boundaries — new features go in the right file, not appended to a 1,700-line soup.

This isn't a feature I'd notice in daily use, but it increases my confidence that the tool will continue improving rather than collapsing under its own weight.

---

## 2. CLI Ergonomics Report — Unchanged

No new commands or flags in Wave 5. The existing CLI surface remains as reviewed in Round 3:
- ✅ Shell completion, `--quiet`, `--retry-failed`, usage examples in `--help`
- ❌ Still no single-command pipeline, `scan`/`analyze` still confusing

---

## 3. Issue-by-Issue Resolution Status

### P0 — Blocking (ALL RESOLVED ✅ — unchanged since R1)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P0-1 | Silent simulation fallback | ✅ Fixed (Wave 1) | Stable |
| P0-2 | Non-TypeScript `.ts` config | ✅ Fixed (Wave 1) | Stable |
| P0-3 | No "Getting Started" in help | ✅ Fixed (Wave 1) | Stable |

### P1 — Painful (4/6 RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| P1-1 | 5-command pipeline → single command | ⚠️ Partially addressed | The pipeline is now clearly visible in `pipeline.ts` (229 lines), making it straightforward to add auto-init/scan/plan. But the user-facing flow hasn't changed |
| P1-2 | `scan` vs `analyze` confusion | ❌ Open | Oldest open issue — 4 rounds and counting |
| P1-3 | No retry for failed tasks | ✅ Fixed (Wave 4) | Stable |
| P1-4 | No usage examples in `--help` | ✅ Fixed (Wave 3) | Stable |
| P1-5 | No shell completion | ✅ Fixed (Wave 4) | Stable |
| P1-6 | `run.ts` monolith (contributor UX) | ✅ Fixed (Wave 5) | 1,691 lines → 8 modules. Contributors can now navigate, understand, and modify the run pipeline without reading 1,700 lines of context |

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

## 4. What the Decomposition Enables

From a UX perspective, the `run/` decomposition makes several previously-difficult improvements now straightforward:

1. **Single-command pipeline (P1-1)**: `pipeline.ts` at 229 lines is the natural place to add auto-detection. "If no tasks found, auto-scan. If no config, auto-init." The logic would be ~30 lines in a clearly scoped orchestrator, not buried in a 1,700-line monolith.

2. **Better error messages per phase**: Each module can now have focused error handling. `pr.ts` can have PR-specific error messages. `retry.ts` can explain contribution log format issues. Previously, errors from all phases were interleaved in one file.

3. **Per-module testing**: `discoverTasks()`, `createPullRequest()`, `runRetryPipeline()` are independently importable. Tests can target specific phases without mocking the entire pipeline.

---

## 5. Comparison Update

| Aspect | R1 | R2 | R3 | R4 | Benchmark |
|--------|-----|-----|-----|-----|-----------|
| `--help` examples | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| `--quiet` mode | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Getting Started | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Fail on missing prereqs | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Config types | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Shell completion | ✗ | ✗ | ✅ | ✅ | ✓ Standard |
| Retry failed | ✗ | ✗ | ✅ | ✅ | ✓ Standard |
| Single-command flow | ✗ | ✗ | ✗ | ✗ | ✓ `gh pr create` |
| Failed task details | ✗ | ✅ | ✅ | ✅ | ✓ Standard |
| Modular codebase | ✗ | ✗ | ✗ | ✅ | ✓ Maintainability |

8 of 10 baseline expectations met.

---

## 6. Revised Prioritized Improvements

### P1 — Painful (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P1-1 | Single-command `oac run` pipeline | 2-3 hours (reduced from 4-6 — `pipeline.ts` is now a clean 229-line orchestrator) | Biggest remaining time-to-value improvement |
| P1-2 | Merge `scan`/`analyze` or clarify | 2-3 hours | Eliminates oldest open confusion |

### P2 — Annoying (Remaining)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P2-2 | Progress percentages on long ops | 2-3 hours | Reduces anxiety on large repos |
| P2-4 | Config reference docs | 1-2 hours | Auto-generate from Zod schema |
| P2-5 | CHANGELOG.md | 30 min | User trust on upgrades |

---

## 7. Final Verdict

**Would I keep using OAC?** — **Yes.**

The tool works, the CLI is ergonomic, and recovery from failures doesn't waste tokens. Wave 5 didn't add features I interact with directly, but it makes me more confident the tool won't stagnate. A 1,700-line monolith is where features go to die — modular code is where they thrive.

**What still bothers me**: `scan` vs `analyze` confusion (P1-2) has survived 4 rounds of improvements. It's now the oldest open issue. And `oac run` still can't auto-detect the need for scanning — you have to know the pipeline steps.

**What would push this to 9/10**: Implement the single-command pipeline (P1-1) and resolve the scan/analyze confusion (P1-2). The decomposition makes P1-1 significantly easier — `pipeline.ts` is now a clean 229-line orchestrator where auto-detection logic fits naturally.

**Score: 8.5/10** — Up from 8/10. The decomposition is a structural investment that pays dividends through contributor UX and future feature velocity. The tool's architecture now matches its ambition — clean, modular, and ready for the next wave of user-facing improvements.

