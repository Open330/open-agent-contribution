# End-User Experience Review — OAC v2026.4.2

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-18  
**Persona**: Senior full-stack dev, maintains 3-4 OSS projects, found OAC on HN, has 15 minutes to get it working  
**Scope**: CLI interface, error handling, documentation, workflow integration

---

## 1. First Impression — 5/10

### Installation

`npm install -g @open330/oac` — straightforward if it works. The package name is clear. No post-install scripts visible in the source.

### First Command: `oac` with No Arguments

Running `oac` with no arguments shows the Commander.js default help. It lists commands: `init`, `doctor`, `scan`, `analyze`, `plan`, `run`, `status`, `log`, `leaderboard`. Global options: `--config`, `--verbose`, `--json`, `--no-color`, `-V/--version`.

**Problem**: Nine commands on first sight is overwhelming. A new user doesn't know whether to start with `init`, `doctor`, or `scan`. There's no "Getting Started" flow hint in the help output — no "Run `oac init` to get started" suggestion at the bottom.

### Init Wizard: `oac init`

The init wizard uses `@inquirer/prompts` for interactive setup. It asks about repos, provider, budget, and generates `oac.config.ts`.

**Critical issue**: The generated config file is named `oac.config.ts` but contains plain JavaScript (`export default { ... }`) without:
- `import { defineConfig } from '@open330/oac'` 
- TypeScript type annotations
- Any `satisfies` or `as const` pattern

A TypeScript file that isn't TypeScript is confusing. Users who open it in their editor will see no type-checking, no autocomplete, no validation. The `.ts` extension sets an expectation the content doesn't fulfill.

### Doctor Check: `oac doctor`

Good concept — checks Node.js version (≥24), git, gh auth (with scope checking), Claude CLI, Codex CLI. Provides actionable suggestions when checks fail.

**Issue**: Uses raw `child_process.spawn` instead of `execa` like every other module. Not a UX issue per se, but the inconsistency means error handling behavior differs from other commands.

### Time to First Successful Run

Estimated: **15-30 minutes** for a user who has all prerequisites. The pipeline is `init → doctor → scan/analyze → plan → run`. That's 4-5 commands before seeing a real PR. For a tool that promises to "reclaim unused tokens," the time-to-value is high.

**What would improve this**: A single `oac run --repo owner/name` that auto-detects missing setup and either runs init inline or provides a one-liner to fix it.

---

## 2. CLI Ergonomics Report

### Help Text Quality

Each command has a description in `--help`, but:
- **No usage examples** in any command's help text. `oac scan --help` tells you what flags exist but not how to use them together.
- **No command aliases**: Can't use `oac r` for `oac run` or `oac s` for `oac scan`.
- Flag descriptions are terse. `--limit <n>` — limit what? Tasks? Files? Output lines?

### Flag Consistency — Good

- `--repo <owner/name>` is consistent across `scan`, `analyze`, `plan`, `run` ✓
- `--verbose`, `--json`, `--no-color` are global options ✓
- `--limit`, `--provider` are consistent where used ✓

### scan vs analyze — The Naming Problem

These two commands have overlapping purposes that aren't clear from help text:
- `scan`: "Quick task discovery" — runs scanners, outputs flat task list
- `analyze`: "Deep codebase analysis" — runs scanners AND groups into epics

A new user will run one, get results, then discover the other exists and wonder which they should have used. The distinction ("flat list" vs "grouped into epics") isn't obvious from the command names.

**What `gh`, `docker`, `terraform` do**: They don't have two commands for the same operation at different depths. `terraform plan` is one command. `docker build` is one command. Having `scan` and `analyze` is like having `docker build-quick` and `docker build-deep`.

### Missing Flags

- **No `--quiet` flag**: Has `--verbose` and `--json` but no quiet mode. Scripts that want zero output except errors have no option.
- **No `--yes` / `-y` flag**: No way to skip confirmation prompts for CI/CD usage.
- **No shell completion**: No `oac completion bash/zsh/fish` command. Every mature CLI offers this (`gh completion`, `docker completion`, `kubectl completion`).

---

## 3. Error Experience Audit

### Error Architecture — Well Designed Internally

`OacError` class in `errors.ts` has:
- Typed error codes grouped by category (config, repo, discovery, budget, execution, completion, tracking)
- Severity levels (fatal, error, warning, info)
- Factory functions per domain (`OacError.config()`, `OacError.repo()`, etc.)

This is **good internal design**. The question is whether these structured errors surface well to users.

### Error Scenarios

| Scenario | Handling | Grade |
|----------|----------|-------|
| Missing config file | Clear error + suggestion to run `oac init` | ✓ Good |
| Invalid config | Zod validation catches early with field-level errors | ✓ Good |
| Git not installed | `oac doctor` detects with actionable message | ✓ Good |
| `gh` not authenticated | Checks auth status AND scope permissions | ✓ Good |
| Agent CLI not available | **Silently falls back to simulated execution** | ✗ Critical |
| Network failure during PR | No timeout protection — hangs indefinitely | ✗ Bad |
| Partial task failure | Shows in summary but no retry mechanism | ⚠️ Incomplete |

### ✗ Critical: Silent Simulation Fallback

When no agent CLI (Claude/Codex) is available, `oac run` **silently falls back to simulated execution** with fake delays (`simulateExecution`). The simulation:
- Introduces artificial delays to mimic real execution
- Generates fake results
- A real user would believe tasks are actually running and PRs are being created

This is the **single worst UX decision** in the codebase. A user who doesn't have Claude CLI installed runs `oac run`, waits for "execution" to complete, sees "success" results, and then... nothing happened. No PRs, no real contributions.

**What it should do**: Fail fast with: `Error: No agent CLI found. Install Claude Code CLI or OpenAI Codex CLI. Run \`oac doctor\` for setup instructions.`

Or at minimum: show a **prominent warning** like `⚠️ SIMULATION MODE — no agent CLI detected. Results are simulated. Install claude-code or codex CLI for real execution.`

---

## 4. Feedback & Output Quality

### Progress Indicators — Good

- Uses `ora` spinners consistently across commands ✓
- Spinners show context: "Scanning repository...", "Analyzing codebase..." ✓
- JSON output mode (`--json`) supported for machine consumption ✓

### Summary Quality

After `oac run`, the summary shows:
- Tasks attempted / succeeded / failed
- PRs created with links
- Token usage

This is good. But:
- **No ETA during long operations**: Spinner shows activity but not progress percentage or time remaining
- **No way to see what failed and why**: Summary says "2 failed" but doesn't show error details without `--verbose`

### Watch Mode (`oac status --watch`)

Uses `setInterval` + `console.clear()`:
- **No graceful Ctrl+C handling**: Process doesn't clean up on SIGINT
- **No way to exit cleanly**: Must Ctrl+C which may leave terminal in odd state
- Screen flicker from `console.clear()` — a TUI library (blessed, ink) would be better

### Color & Formatting

- Uses chalk for colors ✓
- `--no-color` flag available ✓
- Table output for leaderboard and log commands ✓

---

## 5. Documentation Gap Analysis

### README

The README exists and covers:
- What OAC does ✓
- Installation command ✓
- Basic command list ✓
- Configuration example ✓

**Missing**:
- **Quick Start guide**: Step-by-step from install to first PR. "Run these 4 commands and you'll see your first automated PR in 10 minutes."
- **Real-world examples**: No example of `oac run` output, no example PR screenshots, no example config for common setups
- **Troubleshooting section**: No FAQ, no common error solutions
- **CI/CD documentation**: No GitHub Actions workflow example. For a tool that automates contributions, CI integration should be front and center
- **Exit code documentation**: What does `oac run` return on partial success? Scripts need to know
- **Token budget explanation**: How are tokens estimated? What does "budget: 10000" mean in practice? How many PRs is that?

### Config Documentation

`oac.config.ts` options are defined in Zod schemas (`config.ts`) with defaults, but:
- No config reference documentation in README or docs
- Users must read source code to understand all available options
- No commented example config generated by `oac init`

### Changelog

No `CHANGELOG.md` found. Users can't see what changed between versions.

---

## 6. Workflow Friction Points

### Friction Point 1: The 5-Command Pipeline

To go from install to first PR:
1. `npm install -g @open330/oac`
2. `oac init` (interactive wizard)
3. `oac doctor` (verify setup)
4. `oac scan --repo owner/name` or `oac analyze --repo owner/name`
5. `oac plan --repo owner/name`
6. `oac run --repo owner/name`

That's 5-6 commands. `gh` gets you to a PR in 1 command (`gh pr create`). `terraform` gets you to applied infra in 2 (`terraform plan && terraform apply`). OAC's pipeline has too many mandatory intermediate steps.

**Suggestion**: `oac run --repo owner/name` should handle the full pipeline (scan → plan → execute → PR) in a single command. The individual commands can exist for power users who want fine-grained control.

### Friction Point 2: scan vs analyze Decision

A new user doesn't know which to use. Running the wrong one wastes time. There should be one command with a `--depth quick|deep` flag, or `analyze` should be the default and `scan` should be an alias for `analyze --depth quick`.

### Friction Point 3: No Retry for Failed Tasks

After `oac run` completes with partial failures (3/5 tasks succeeded), there's no `oac retry` or `oac run --retry-failed`. The user must re-run the entire pipeline, re-scanning and re-planning tasks that already succeeded.

### Friction Point 4: Simulated Execution Without Consent

The simulation fallback is the biggest friction point. A user who spent 15 minutes setting up OAC, runs `oac run`, waits for it to "complete," and then discovers nothing actually happened will uninstall immediately. This should be opt-in (`oac run --simulate`) or at minimum require explicit acknowledgment.

### Friction Point 5: No `oac undo` or Rollback

If `oac run` creates unwanted PRs, there's no built-in way to close them. The user must manually close PRs via `gh pr close` for each one. A `oac cleanup --last-run` would be valuable.

---

## 7. Comparison to Similar Tools

### vs `gh` (GitHub CLI)

| Aspect | `gh` | `oac` |
|--------|------|-------|
| Time to first action | ~30 seconds | ~15-30 minutes |
| Shell completion | ✓ | ✗ |
| Interactive prompts | Smart defaults, skip with flags | Required wizard |
| Error messages | Contextual, with suggestions | Good internally, inconsistent surfacing |
| `--help` quality | Examples included | No examples |
| CI/CD docs | Extensive | None |
| Aliases | `gh alias set` | None |

### vs `docker`

| Aspect | `docker` | `oac` |
|--------|----------|-------|
| Command clarity | One command per action | `scan` vs `analyze` overlap |
| Verbose/quiet | `-q` flag everywhere | `--verbose` only, no `--quiet` |
| Dry run | `--dry-run` on destructive ops | `--dry-run` on `run` ✓ |
| Output formats | `--format` with Go templates | `--json` ✓ |

### vs `terraform`

| Aspect | `terraform` | `oac` |
|--------|-------------|-------|
| Pipeline | `plan` → `apply` (2 steps) | `scan/analyze` → `plan` → `run` (3-4 steps) |
| Plan review | Shows exact changes before apply | Shows task list but not expected changes |
| State management | `.tfstate` with locking | `.oac/` without locking |
| Partial applies | `-target` flag for specific resources | No per-task targeting |

### Key Takeaway

Every mature CLI tool shares these patterns that OAC lacks:
1. **Shell completion** — tab completion for commands and flags
2. **Usage examples in `--help`** — not just flag descriptions
3. **`--quiet` mode** — for scripting and CI
4. **Single-command happy path** — one command for the common case

---

## 8. Prioritized UX Improvements

### P0 — Blocking (Would cause new user to abandon)

| # | Issue | Fix |
|---|-------|-----|
| P0-1 | Silent simulation fallback when no agent CLI | Fail fast with actionable error, or require `--simulate` flag |
| P0-2 | `oac init` generates non-TypeScript `.ts` file | Generate proper TypeScript with `defineConfig` import and types |
| P0-3 | No "Getting Started" flow in help output | Add `Run 'oac init' to get started` to root help |

### P1 — Painful (Cause frustration, have workarounds)

| # | Issue | Fix |
|---|-------|-----|
| P1-1 | 5-command pipeline to first PR | Make `oac run` handle full pipeline by default |
| P1-2 | `scan` vs `analyze` confusion | Merge into one command with `--depth` flag |
| P1-3 | No retry for failed tasks | Add `oac run --retry-failed` |
| P1-4 | No usage examples in `--help` | Add `.example()` to Commander commands |
| P1-5 | No shell completion | Add `oac completion` subcommand |

### P2 — Annoying (Papercuts that accumulate)

| # | Issue | Fix |
|---|-------|-----|
| P2-1 | No `--quiet` flag | Add global `--quiet` option |
| P2-2 | No ETA on long operations | Show progress percentage where possible |
| P2-3 | Status watch mode flickers and doesn't handle Ctrl+C | Use proper TUI library or add SIGINT handler |
| P2-4 | No config reference documentation | Generate config docs from Zod schema |
| P2-5 | No changelog | Add CHANGELOG.md with release notes |
| P2-6 | Failed task details hidden without `--verbose` | Show top-level error reason in default output |

### P3 — Polish (Nice-to-haves that delight)

| # | Issue | Fix |
|---|-------|-----|
| P3-1 | No command aliases | Add `oac r` for `oac run`, etc. |
| P3-2 | No `oac cleanup` for unwanted PRs | Add rollback command |
| P3-3 | No CI/CD documentation | Add GitHub Actions workflow example |
| P3-4 | No interactive mode for `oac plan` | Let user select/deselect tasks before execution |
| P3-5 | Scanner name inconsistency (camelCase vs kebab) | Normalize to one convention |
| P3-6 | No `oac config validate` command | Validate config without running pipeline |

---

## 9. Final Verdict

**Would I keep using OAC?** — **Not yet.**

The concept is compelling — reclaiming unused AI tokens for automated open source contributions is a genuine need. The architecture is reasonable, the error system is well-designed, and commands like `doctor` show thoughtfulness about the user experience.

But the **silent simulation fallback** would have lost me on first run. I'd have spent 15 minutes setting up, watched "tasks execute," and then realized nothing happened. That's a trust violation that's hard to recover from.

The **5-command pipeline** is too much friction for a tool that promises to save time. If I'm spending more time operating the tool than it saves me, the value proposition is negative.

**The one thing that would change my answer**: Make `oac run --repo owner/name` a single-command experience that:
1. Auto-detects missing setup and guides you through it inline
2. **Refuses to run** without a real agent CLI (no silent simulation)
3. Shows a plan summary and asks for confirmation before spending tokens
4. Reports results with enough detail to know what happened without `--verbose`

If that one command works reliably from a cold start, OAC becomes a tool I'd add to my Sunday maintenance routine. Until then, it's a promising prototype that respects its own architecture more than its user's time.

