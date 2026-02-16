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

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.15+-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

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
# That's it. One command.
oac run --repo facebook/react --tokens 50000
```

```
  Scanning facebook/react...
  Found 23 tasks (12 lint fixes, 6 TODOs, 5 test gaps)

  Budget: 50,000 tokens
  Selected: 8 tasks (est. 42,300 tokens)
  Reserve: 5,000 tokens (10%)

  [Claude] ████████░░ 4/8 tasks completed
  [Claude] ✔ PR #1847: Fix unused imports in scheduler
  [Claude] ✔ PR #1848: Add tests for reconciler edge case
  [Claude] ⠋ Resolving TODO in ReactFiberHooks.js...

  ─────────────────────────────────────
  Done! 7/8 tasks succeeded
  PRs created: 7
  Tokens used: 38,420 / 50,000
  Contribution logged to .oac/contributions/
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

- **Node.js** >= 22
- **pnpm** >= 9.15
- **git** installed
- At least one AI agent CLI: [Claude Code](https://claude.ai/code), [Codex](https://github.com/openai/codex), or [OpenCode](https://github.com/opencode-ai/opencode)

### Install

```bash
# From npm (coming soon)
npm install -g @oac/cli

# From source
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
  [✔] Node.js     v22.11.0
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
| `oac scan` | Discover tasks in a repo without executing |
| `oac plan` | Show execution plan with token budget breakdown |
| `oac run` | Full pipeline: scan → estimate → execute → PR → track |
| `oac status` | Show running/recent job status |
| `oac log` | View contribution history |
| `oac leaderboard` | Show contribution rankings |
| `oac dashboard` | Launch localhost web dashboard |

### `oac run` — The Main Event

```bash
oac run \
  --repo owner/repo \       # Target repository
  --tokens 50000 \          # Token budget
  --provider claude-code \  # AI agent to use
  --concurrency 2 \         # Parallel agents (default: 2)
  --mode new-pr \           # Create PRs (or: direct-commit)
  --dry-run                 # Preview without executing
```

### `oac scan` — See What's Out There

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

OAC uses a TypeScript config file for full IDE autocompletion:

```typescript
// oac.config.ts
import { defineConfig } from '@oac/core';

export default defineConfig({
  repos: ['facebook/react', 'vercel/next.js'],

  provider: {
    id: 'claude-code',
    options: { model: 'opus' },
  },

  budget: {
    totalTokens: 100_000,
    reservePercent: 0.10,
  },

  discovery: {
    scanners: {
      lint: true,
      todo: true,
      testGap: true,
      deadCode: false,
      githubIssues: true,
    },
    issueLabels: ['good-first-issue', 'help-wanted', 'bug'],
  },

  execution: {
    concurrency: 2,
    mode: 'new-pr',
    taskTimeout: 300,
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

### Monorepo Structure

```
packages/
├── core/          # Event bus, config, types, errors
├── repo/          # GitHub repo resolution, cloning, metadata
├── discovery/     # Task scanners (lint, TODO, test-gap, issues)
├── budget/        # Token estimation, complexity analysis, planning
├── execution/     # Agent pool, job queue, worktree sandbox
├── completion/    # PR creation, issue linking, webhooks
├── tracking/      # Contribution logs, leaderboard
├── cli/           # Commander.js CLI application
└── dashboard/     # Fastify + React localhost dashboard
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+, TypeScript 5.7+, ESM |
| Build | pnpm workspaces, Turborepo, tsup |
| CLI | Commander.js, chalk, ora, cli-table3 |
| Git | simple-git, git worktrees for isolation |
| GitHub | @octokit/rest |
| AI Agents | Claude Code, Codex CLI, OpenCode (pluggable) |
| Dashboard | Fastify, React, Vite, shadcn/ui, Tailwind |
| Quality | Vitest, Biome, 80% coverage threshold |

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
   ┌─────────┐     TODO, lint, test-gap,     ┌──────────┐
   │  Scan   │──── GitHub issues ──────────▶│  Tasks   │
   └────┬────┘                              └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     tiktoken counting,       ┌──────────┐
   │ Budget  │──── knapsack selection ─────▶│   Plan   │
   └────┬────┘     (10% reserve)            └────┬─────┘
        │                                        │
        ▼                                        ▼
   ┌─────────┐     git worktree per agent   ┌──────────┐
   │Execute  │──── parallel sandboxes ─────▶│ Results  │
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
   └─────────┘                              └──────────┘
```

---

## Supported AI Agents

| Agent | Status | Provider ID |
|-------|--------|-------------|
| [Claude Code](https://claude.ai/code) | Supported | `claude-code` |
| [Codex CLI](https://github.com/openai/codex) | Planned | `codex-cli` |
| [OpenCode](https://github.com/opencode-ai/opencode) | Planned | `opencode` |
| Custom | Implement `AgentProvider` interface | any string |

### Adding a Custom Agent

```typescript
import type { AgentProvider } from '@oac/execution';

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

- [x] **v0.1** — Core engine, CLI (init/doctor/scan/plan/run), 2 scanners, single agent
- [ ] **v0.2** — Parallel execution, all 5 scanners, multi-agent support, leaderboard
- [ ] **v0.3** — Web dashboard, Linear/Jira webhooks, PR monitoring
- [ ] **v0.4** — Security hardening, diff validation, crash reports, npm publish
- [ ] **v1.0** — Plugin system, gamification, sparse checkout for large repos

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
