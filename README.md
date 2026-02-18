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
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)

[Getting Started](#-getting-started) · [How It Works](#-how-it-works) · [Commands](#-commands) · [Architecture](#-architecture) · [Contributing](#-contributing)

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
| **Ship** | PR Automation | Creates PRs, links issues, notifies Linear/Jira via webhooks |
| **Track** | Contribution Logs | Git-native audit trail in `.oac/` — who contributed what, with how many tokens |
| **Rank** | Leaderboard | See who's recycling the most tokens across your team |

---

## Quick Start

### Prerequisites

- **Node.js** >= 24
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
| `oac init` | Interactive setup wizard — creates `oac.config.ts` |
| `oac doctor` | Verify environment (Node, git, agents, auth) |
| `oac analyze` | Deep codebase analysis — builds context, groups findings into epics |
| `oac scan` | Quick task discovery without grouping or context |
| `oac plan` | Show execution plan with token budget breakdown |
| `oac run` | Full pipeline: analyze → group epics → execute → PR → track |
| `oac status` | Show running/recent job status |
| `oac log` | View contribution history |
| `oac leaderboard` | Show contribution rankings |

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
  --dry-run                 # Preview without executing

# Run with unlimited budget
oac run --repo owner/repo --tokens unlimited --provider codex

# Auto-analyzes if no context exists (or use --force to re-analyze)
```

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
| Core | `src/core/` | Event bus, config (Zod), types, errors |
| Repo | `src/repo/` | GitHub repo resolution, shallow cloning, metadata cache |
| Discovery | `src/discovery/` | Codebase analyzer, epic grouper, backlog, scanners (lint, TODO, test-gap, GitHub issues) |
| Budget | `src/budget/` | Token estimation (tiktoken), complexity analysis, execution planner |
| Execution | `src/execution/` | Agent adapters (Claude Code, Codex), worktree sandbox, worker |
| Completion | `src/completion/` | PR creation (Octokit), diff validation, issue linking |
| Tracking | `src/tracking/` | Contribution logs, leaderboard, JSON schema |
| CLI | `src/cli/` | Commander.js commands: init, doctor, analyze, scan, plan, run, status, log, leaderboard |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24+, TypeScript 5.7+, ESM |
| Build | pnpm, tsup |
| CLI | Commander.js, chalk, ora, cli-table3 |
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
- [ ] **Next** — OpenCode adapter, multi-agent routing, localhost dashboard
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

## Philosophy

> **"Don't let your tokens go to waste."**

Every month, developers around the world leave millions of AI tokens on the table. OAC turns that idle capacity into real open source contributions — automatically, safely, and transparently.

No hosted services. No data collection. No lock-in. Just your machine, your tokens, and your repos.

---

<div align="center">

**Built with spare tokens by the [Open330](https://github.com/Open330) community.**

[Report Bug](https://github.com/Open330/open-agent-contribution/issues) · [Request Feature](https://github.com/Open330/open-agent-contribution/issues) · [Discussions](https://github.com/Open330/open-agent-contribution/discussions)

</div>
