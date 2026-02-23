<div align="center">

```
                                 ___    _    ____
                                / _ \  / \  / ___|
                               | | | |/ _ \| |
                               | |_| / ___ \ |___
                                \___/_/   \_\____|

              O P E N   A G E N T   C O N T R I B U T I O N
```

**Put your spare AI tokens to work. Contribute to open source — automatically.**

[![npm](https://img.shields.io/npm/v/@open330/oac?label=npm&color=CB3837&logo=npm)](https://www.npmjs.com/package/@open330/oac)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)

[Getting Started](#-getting-started) · [How It Works](#-how-it-works) · [Commands](#commands) · [Configuration](#configuration) · [Concurrency & Multi-User Safety](#concurrency--multi-user-safety) · [Architecture](#architecture) · [Contributing](#contributing)

</div>

---

## The Problem

You pay for AI agent tokens every month. Claude Code, Codex, OpenCode — they all come with token budgets. But most days, you don't use them all. Those leftover tokens? **Wasted.**

Meanwhile, thousands of open source repos have TODOs nobody finishes, lint warnings nobody fixes, tests nobody writes, and issues nobody picks up.

## The Solution

**OAC** bridges the gap. Point it at a repo, and it will:

1. **Scan** the codebase for actionable tasks (TODOs, lint issues, missing tests, open GitHub issues)
2. **Estimate** token costs and pick tasks that fit your remaining budget
3. **Execute** the work using your AI agent of choice — in parallel, sandboxed environments
4. **Submit** pull requests, link issues, and track every contribution

```bash
# Install globally
npm install -g @open330/oac

# That's it. One command.
oac run --repo facebook/react --tokens 50000

# Or run without installing
npx @open330/oac run --repo facebook/react --tokens unlimited
```

```
  ✔ Resolved facebook/react
  ✔ Repository ready at ~/.oac/cache/repos/facebook/react
  ✔ Analyzed 12 modules, 847 files, 23 findings
  ✔ Created 4 epic(s)
  ✔ Epic token estimation completed
  [oac] Selected 3 epic(s) for execution, 1 deferred.

  ✔ Improve test coverage for reconciler (1/3)
      PR #1847: https://github.com/facebook/react/pull/1847
  ✔ Fix lint warnings in scheduler (2/3)
      PR #1848: https://github.com/facebook/react/pull/1848
  ✔ Address TODO comments (3/3)
      PR #1849: https://github.com/facebook/react/pull/1849

  Run Summary (Epic Mode)
    Epics completed: 3/3
    PRs created:     3
    Tokens used:     38,420 / 50,000
    Duration:        8m 42s
```

---

## Features

| | Feature | Description |
|---|---------|-------------|
| **Scan** | Task Discovery | Finds TODOs, lint issues, test gaps, dead code, and open GitHub issues |
| **Budget** | Token Estimation | Per-provider token counting with knapsack-optimized task selection |
| **Run** | Parallel Execution | Run 2-3 agents simultaneously in isolated git worktrees |
| **Retry** | Resume Failed | `--retry-failed` re-runs only tasks that failed in the previous run |
| **Ship** | PR Automation | Creates PRs with timeout protection, links issues, notifies webhooks |
| **Track** | Contribution Logs | Git-native audit trail in `.oac/` — who contributed what, with how many tokens |
| **Rank** | Leaderboard | See who's recycling the most tokens across your team |
| **Explain** | Task Inspector | `oac explain <id>` shows why a task was selected and what the agent will do |
| **Complete** | Shell Integration | Tab-completion for bash, zsh, and fish shells |

---

## Quick Start

### Prerequisites

- **Node.js** >= 20 (see `engines` in package.json)
- **git** installed
- At least one AI agent CLI: [Claude Code](https://claude.ai/code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)

### Install

```bash
# From npm (recommended)
npm install -g @open330/oac

# Or use without installing
npx @open330/oac --help

# From source (for contributors)
git clone https://github.com/Open330/open-agent-contribution.git
cd open-agent-contribution
pnpm install
pnpm build
```

### Setup

```bash
# Interactive setup wizard
oac init

# Or quick start without wizard
oac init --minimal --repo owner/repo
```

```
   ___    _    ____
  / _ \  / \  / ___|
 | | | |/ _ \| |
 | |_| / ___ \ |___
  \___/_/   \_\____|

 Welcome to Open Agent Contribution.
 Let's put your spare tokens to work.

? Select your AI providers: › Claude Code, Codex CLI
? Monthly token budget for OAC: › 100000
? Add your first repo (owner/repo): › facebook/react

✔ Config written to oac.config.ts
✔ Created .oac/ tracking directory
Ready! Run 'oac doctor' to verify or 'oac run' to start.
```

### Verify

```bash
oac doctor
```

```
  Environment Check
  ─────────────────
  [✔] Node.js     v24.0.0
  [✔] git         v2.43.0
  [✔] GitHub Auth  gh authenticated as @jiun
  [✔] Claude CLI   v1.0.16
  [✘] Codex CLI    not found

  4/5 checks passed
```

---

## Commands

| Command | Description |
|---------|-------------|
| `oac init` | Interactive setup wizard — creates `oac.config.ts` (`--minimal` for quick start) |
| `oac doctor` | Verify environment (Node, git, agents, auth) |
| `oac analyze` | Deep codebase analysis — builds module context, groups findings into epics |
| `oac scan` | Quick task discovery — finds actionable items without building full context |
| `oac plan` | Show execution plan with token budget breakdown |
| `oac run` (alias: `oac r`) | **Primary command.** Full pipeline: analyze → plan → execute → PR → track |
| `oac status` | Show running/recent job status |
| `oac log` | View contribution history |
| `oac leaderboard` | Show contribution rankings |
| `oac completion` | Generate shell tab-completion scripts (bash/zsh/fish) |
| `oac explain <id>` | Show why a task/epic was selected and what the agent will do |

### `oac analyze` — Deep Codebase Analysis

```bash
oac analyze --repo owner/repo [--force] [--format table|json]
```

Builds a full codebase map (modules, files, exports, dependencies), runs all scanners, groups findings into epics, and persists everything to `.oac/context/`. The analysis is cached — subsequent runs only re-analyze changed files (incremental via `git diff`).

### `oac run` — The Main Event

```bash
oac run \
  --repo owner/repo \       # Target repository
  --tokens 50000 \          # Token budget (or "unlimited")
  --provider claude-code \  # AI agent to use (claude-code or codex)
  --concurrency 2 \         # Parallel agents (default: 2)
  --mode new-pr \           # Create PRs (or: direct-commit)
  --dry-run \               # Preview without executing (with colored diff)
  --quiet \                 # Suppress spinner/progress output (for CI)
  --retry-failed            # Re-run only previously failed tasks

# Run with unlimited budget
oac run --repo owner/repo --tokens unlimited --provider codex

# Auto-analyzes if no context exists (or use --force to re-analyze)
# Shorthand alias: oac r
```

**Exit Codes:**

| Code | Meaning |
|------|---------|
| `0` | All tasks/epics completed successfully (or dry-run) |
| `1` | Unexpected / unhandled error |
| `2` | Configuration or validation error |
| `3` | All selected tasks/epics failed |
| `4` | Partial success — some tasks succeeded, others failed |

### `oac scan` — Quick Task Discovery

```bash
oac scan --repo owner/repo --format table
```

```
┌─────────┬──────────────────────────────────┬────────┬──────────┬────────────┐
│ ID      │ Title                            │ Source │ Priority │ Complexity │
├─────────┼──────────────────────────────────┼────────┼──────────┼────────────┤
│ a1b2c3  │ Fix unused import in utils.ts    │ lint   │ 85       │ trivial    │
│ d4e5f6  │ TODO: Add input validation       │ todo   │ 72       │ simple     │
│ g7h8i9  │ Missing tests for Parser class   │ test   │ 68       │ moderate   │
│ j0k1l2  │ Remove dead code in legacy/      │ dead   │ 45       │ simple     │
│ #142    │ Fix date formatting bug          │ issue  │ 91       │ moderate   │
└─────────┴──────────────────────────────────┴────────┴──────────┴────────────┘
  5 tasks discovered
```

---

## Configuration

OAC uses a TypeScript config file:

```typescript
// oac.config.ts
import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: ["facebook/react", "vercel/next.js"],

  execution: {
    provider: "claude-code",  // or "codex"
    concurrency: 2,
    mode: "new-pr",
    taskTimeout: 300,
    tokenBudget: 100_000,     // or "unlimited"
  },

  discovery: {
    scanners: {
      lint: true,
      todo: true,
      testGap: true,
    },
    issueLabels: ["good-first-issue", "help-wanted", "bug"],
  },

  analyze: {
    autoAnalyze: true,         // auto-analyze before run
    staleAfterMs: 86_400_000,  // re-analyze after 24h
  },
});
```

> 📖 **Full reference**: See [docs/config-reference.md](docs/config-reference.md) for every option, type, default, and constraint — auto-generated from the Zod schema.

---

## Concurrency & Multi-User Safety

When multiple OAC instances run against the same repository simultaneously (e.g., several team members running `oac run` at the same time), there is a risk of duplicate PRs targeting the same issue. OAC prevents this with a **2-layer guard system** that checks for existing OAC pull requests at two critical points in the pipeline.

```
  Instance A                          Instance B
  ─────────                           ─────────
  oac run                             oac run
      │                                   │
      ▼                                   ▼
  ┌──────────────┐                   ┌──────────────┐
  │  Layer 1     │                   │  Layer 1     │
  │  Discovery   │ ◄── Both scan ──►│  Discovery   │
  │  PR check    │     GitHub PRs    │  PR check    │
  └──────┬───────┘                   └──────┬───────┘
         │                                  │
    Issue #42 not                      Issue #42 not
    claimed → keep                     claimed → keep
         │                                  │
         ▼                                  ▼
    (analyze, plan,                    (analyze, plan,
     execute...)                        execute...)
         │                                  │
         ▼                                  ▼
  ┌──────────────┐                   ┌──────────────┐
  │  Layer 3     │                   │  Layer 3     │
  │  Pre-PR      │                   │  Pre-PR      │
  │  guard       │                   │  guard       │
  └──────┬───────┘                   └──────┬───────┘
         │                                  │
    No OAC PR yet                     Instance A's PR
    → create PR ✔                     now exists → skip ✘
```

### Layer 1: Discovery-Time Filtering

During task discovery, the GitHub Issues scanner fetches all open PRs whose title starts with `[OAC]` and extracts the issue numbers they reference (via `Fixes #N`, `Closes #N`, or `Resolves #N` in the PR body). Any issue that already has a matching OAC PR is filtered out of the task list entirely — the agent never even attempts work on it.

- **When:** Runs at the start of every `oac run`, during the scan phase
- **Effect:** Issues with existing OAC PRs are excluded from the task list
- **Failure mode:** Fail-open — if the GitHub API is unreachable, no issues are filtered out and the pipeline continues normally

### Layer 3: Pre-PR Guard

Even after Layer 1, a race condition is possible: two instances might discover the same issue before either has created a PR. Layer 3 closes this gap by performing a second check immediately before pushing the branch and creating the PR. If another OAC PR for the same issue now exists, the PR creation is skipped.

- **When:** Runs after code execution and diff validation, just before `git push` and PR creation
- **Effect:** Skips PR creation if a duplicate OAC PR is detected, avoiding wasted pushes
- **Failure mode:** Fail-open — if the check fails, the PR is created anyway (better to create a possible duplicate than to silently discard completed work)

### How OAC PRs Are Identified

Both layers use the same detection logic:
1. Fetch up to 100 most recently updated open PRs from the target repository
2. Filter to PRs whose title starts with **`[OAC]`**
3. Scan the PR body for **`Fixes #N`**, **`Closes #N`**, or **`Resolves #N`**
4. Match the extracted issue number against the current task's linked issue

### Best Practices for Teams

- **No configuration needed.** The guards are always active — there is nothing to enable or disable.
- **Stagger start times slightly** (even 30 seconds apart) to give Layer 1 the best chance of catching duplicates before any work begins.
- **Use a shared config** (`oac.config.ts`) with the same `issueLabels` filter so all instances target the same pool of issues and the guards can detect overlaps.
- **Check `oac log`** after runs to see if any tasks were skipped due to duplicate detection.
- **Don't worry about edge cases.** Both layers are fail-open by design — in the worst case, a duplicate PR is created, which is easy to close manually. No work is ever silently lost.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   oac CLI / Dashboard                │
└────────────────────────┬────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │    Core Engine       │
              │  (Event Bus + Config)│
              └──┬──┬──┬──┬──┬──┬──┘
                 │  │  │  │  │  │
    ┌────────────┘  │  │  │  │  └────────────┐
    │               │  │  │  │               │
┌───▼───┐  ┌───────▼──▼──▼───────┐  ┌───────▼───────┐
│ Repo  │  │  Discovery → Budget  │  │   Tracking    │
│Select │  │  → Execution         │  │  (.oac/ logs) │
└───────┘  └─────────┬───────────┘  └───────────────┘
                     │
              ┌──────▼──────┐
              │  Completion  │
              │ (PR + Issue) │
              └──────┬──────┘
                     │
           ┌─────────▼─────────┐
           │   GitHub / Linear  │
           │   / Jira           │
           └───────────────────┘
```

### Modules

Published as a single package `@open330/oac`:

| Module | Path | Description |
|--------|------|-------------|
| Core | `src/core/` | Event bus, config (Zod), types, errors, memory pressure monitoring |
| Repo | `src/repo/` | GitHub repo resolution, shallow cloning, metadata cache |
| Discovery | `src/discovery/` | Codebase analyzer (streaming for large files), epic grouper, backlog, scanners (lint, TODO, test-gap, GitHub issues) |
| Budget | `src/budget/` | Token estimation (tiktoken), complexity analysis, execution planner, resettable counters |
| Execution | `src/execution/` | Agent adapters (Claude Code, Codex), worktree sandbox, worker |
| Completion | `src/completion/` | PR creation (Octokit) with timeout protection, diff validation, issue linking |
| Tracking | `src/tracking/` | Contribution logs, leaderboard, JSON schema |
| CLI | `src/cli/` | 11 commands: init, doctor, analyze, scan, plan, run, status, log, leaderboard, completion, explain. Run module decomposed into 8 focused sub-modules |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24+, TypeScript 5.7+, ESM |
| Build | pnpm, tsup |
| CLI | Commander.js, chalk, ora, cli-table3 |
| Concurrency | p-queue for bounded parallelism, memory pressure monitoring |
| Process | execa for child process management |
| Git | simple-git, git worktrees for isolation |
| GitHub | @octokit/rest |
| AI Agents | Claude Code (`claude-code`), Codex CLI (`codex`) — pluggable via `AgentProvider` |
| Dashboard | Fastify + embedded SPA with SSE streaming |
| Quality | Vitest, Biome |

---

## Contribution Tracking

Every run creates a JSON log in `.oac/contributions/`:

```
.oac/
├── contributions/
│   ├── 2026-02-17-143052-jiun.json
│   ├── 2026-02-17-151023-jiun.json
│   └── 2026-02-18-091500-alice.json
└── leaderboard.json
```

Each log records: who contributed, which tasks, tokens used, PRs created, and execution metrics. The leaderboard aggregates across all contributors.

```bash
oac leaderboard
```

```
  Contribution Leaderboard
  ────────────────────────
  #1  jiun     42 tasks   284,000 tokens   38 PRs merged
  #2  alice    31 tasks   195,000 tokens   27 PRs merged
  #3  bob      18 tasks   122,000 tokens   15 PRs merged
```

---

## How It Works

OAC uses a **context-first architecture**: it first deeply analyzes the codebase, then groups related findings into coherent **epics** (not tiny per-file tasks), and executes each epic as a single unit with full module context.

```
You run `oac run`
        │
        ▼
   ┌─────────┐     Shallow clone, cache metadata
   │  Repo    │────────────────────────────────────┐
   │  Select  │                                    │
   └────┬─────┘                                    │
        │                                          │
        ▼                                          ▼
   ┌─────────┐     Auto-detect src dir,      ┌──────────┐
   │ Analyze │──── module map, exports, ────▶│ Context  │
   └────┬────┘     LOC, dependencies         │ .oac/    │
        │                                    └────┬─────┘
        ▼                                         │
   ┌─────────┐     TODO, lint, test-gap,     ┌────▼─────┐
   │  Scan   │──── GitHub issues ──────────▶│ Findings │
   └────┬────┘                              └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     Group by module+type,     ┌──────────┐
   │  Group  │──── create coherent units ──▶│  Epics   │
   └────┬────┘     (1 PR per epic)           └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     Per-epic estimation,      ┌──────────┐
   │ Budget  │──── priority-based select ──▶│   Plan   │
   └────┬────┘                              └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     git worktree per epic    ┌──────────┐
   │Execute  │──── with module context ────▶│ Results  │
   └────┬────┘                              └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     Validate diff,           ┌──────────┐
   │Complete │──── create PR, link issue ──▶│   PRs    │
   └────┬────┘                              └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     .oac/contributions/      ┌──────────┐
   │  Track  │──── JSON audit log ─────────▶│  Done!   │
   └─────────┘     update backlog           └──────────┘
```

### Epic-Based Execution vs Per-Task

| | Old (per-task) | New (epic-based) |
|---|---|---|
| Unit | 1 task = 1 file change | 1 epic = N related changes |
| Context | Agent sees only target file | Agent sees full module context |
| PR | 1 PR per file | 1 PR per epic (multi-file) |
| Persistence | None — re-scans every run | Backlog persisted in `.oac/context/` |
| Incremental | Full re-scan | Only re-analyzes git-changed files |

---

## Supported AI Agents

| Agent | Status | Provider ID |
|-------|--------|-------------|
| [Claude Code](https://claude.ai/code) | Supported | `claude-code` |
| [Codex CLI](https://github.com/openai/codex) | Supported | `codex` |
| [OpenCode](https://github.com/opencode-ai/opencode) | Planned | `opencode` |
| Custom | Implement `AgentProvider` interface | any string |

### Adding a Custom Agent

```typescript
import type { AgentProvider } from '@open330/oac-execution';

export class MyAgentAdapter implements AgentProvider {
  readonly id = 'my-agent';
  readonly name = 'My Custom Agent';

  async checkAvailability() { /* ... */ }
  execute(params) { /* ... */ }
  async estimateTokens(params) { /* ... */ }
  async abort(executionId) { /* ... */ }
}
```

---

## Roadmap

- [x] **2026.2.17** — Core engine, CLI, 5 scanners, parallel execution, npm publish
- [x] **2026.2.18** — Context-first architecture: codebase analyzer, epic grouper, incremental analysis, backlog persistence, enhanced prompts with module context
- [x] **2026.4.x** — Claude Code + Codex CLI adapters, token usage reporting, auto-detect sourceDir
- [x] **2026.4.x** — 9-wave quality cycle: performance fixes, UX polish, run module decomposition, shell completion, retry, exit codes, memory monitoring, streaming analysis, config reference docs
- [ ] **Next** — OpenCode adapter, multi-agent routing, localhost dashboard, daemon mode
- [ ] **Future** — Linear/Jira webhooks, plugin system, sparse checkout for monorepos

---

## Contributing

We welcome contributions! OAC is designed to contribute to repos — and it can contribute to itself too.

```bash
# Clone and setup
git clone https://github.com/Open330/open-agent-contribution.git
cd open-agent-contribution
pnpm install
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm lint
pnpm format

# Or just let OAC contribute to itself
npx @open330/oac run --repo Open330/open-agent-contribution --tokens unlimited
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## Troubleshooting

<details>
<summary><strong>Agent not found / command not found</strong></summary>

OAC dispatches work to external agents (`claude`, `codex`). Make sure the agent CLI is installed and on your `PATH`:

```bash
# Verify agents are reachable
oac doctor

# Check individual agents
which claude   # Claude Code
which codex    # Codex CLI
```

If `oac doctor` reports a missing agent, install it following the agent's own documentation, then re-run `oac doctor`.
</details>

<details>
<summary><strong>Token budget exceeded / nothing was executed</strong></summary>

The planner reserves 10% of your budget as a safety margin. If every discovered task exceeds the effective budget, nothing will be selected.

```bash
# Check what would be selected
oac run --dry-run --repo owner/repo

# Increase the budget
oac run --tokens 200000 --repo owner/repo

# Or set it in oac.config.ts
export default defineConfig({
  budget: { totalTokens: 200_000 },
});
```
</details>

<details>
<summary><strong>Config file errors</strong></summary>

```bash
# Validate your config
oac doctor

# Regenerate a minimal config
oac init --minimal --repo owner/repo
```

Common issues:
- Missing `repos` array — at least one repo is required.
- Invalid provider ID — must be `"claude-code"` or `"codex"`.
- `budget.totalTokens` must be a positive number.

See [docs/config-reference.md](docs/config-reference.md) for all options.
</details>

<details>
<summary><strong>Permission denied / GitHub auth errors</strong></summary>

OAC uses `gh` (GitHub CLI) for PR creation and issue access. Make sure you're authenticated:

```bash
gh auth status
gh auth login   # if not authenticated
```

For private repos, ensure your token has `repo` scope.
</details>

<details>
<summary><strong>Sandbox / worktree errors</strong></summary>

OAC creates git worktrees in a temporary directory for each task. If a previous run crashed, stale worktrees may remain:

```bash
# List worktrees
git worktree list

# Clean up stale entries
git worktree prune
```
</details>

---

## Philosophy

> **"Don't let your tokens go to waste."**

Every month, developers around the world leave millions of AI tokens on the table. OAC turns that idle capacity into real open source contributions — automatically, safely, and transparently.

No hosted services. No data collection. No lock-in. Just your machine, your tokens, and your repos.

---

<div align="center">

**Built with spare tokens by the [Open330](https://github.com/Open330) community.**

[Report Bug](https://github.com/Open330/open-agent-contribution/issues) · [Request Feature](https://github.com/Open330/open-agent-contribution/issues) · [Discussions](https://github.com/Open330/open-agent-contribution/discussions)

</div>
