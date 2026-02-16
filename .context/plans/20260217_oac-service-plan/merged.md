# Open Agent Contribution (OAC) - Merged Plan

**Date:** 2026-02-17
**Sources:** Claude (Architecture), Gemini (UX/DX), Codex (Implementation)
**Status:** Decision Document v1.0

---

## Executive Summary

OAC is a local-first CLI tool (with an optional web dashboard) that reclaims value from unused AI agent tokens by automatically discovering and executing contribution tasks against GitHub repositories. It orchestrates multiple AI agent providers through a unified interface, discovers actionable work (lint fixes, missing tests, TODOs, GitHub issues), estimates token costs, executes contributions in parallel sandboxed environments, creates PRs, and tracks all activity through a git-native audit trail.

This merged plan synthesizes three perspectives:
- **Claude (Architecture):** Deep system design -- monorepo structure, core abstractions, data models, security, error handling (~2300 lines)
- **Gemini (UX/DX):** User experience design -- dashboard layouts, color system, onboarding flows, CLI interaction patterns (~200 lines)
- **Codex (Implementation):** Concrete specs -- CLI command tree with output, REST API, dependency versions, testing, CI/CD (~650 lines)

---

## 1. Consensus Points (All Three Agree)

### 1.1 Core Philosophy
- **Local-first execution.** No hosted backend. Everything runs on the developer's machine.
- **CLI-first, dashboard optional.** The CLI is the primary interface; the dashboard is a convenience layer.
- **Provider-agnostic agent abstraction.** Support Claude Code, Codex CLI, OpenCode, and future agents through a common interface.
- **Git-native tracking.** Contribution logs live in `.oac/` as committed JSON files, not a database.
- **Token-conscious budgeting.** Every task is estimated before execution. The system never silently exhausts tokens.

### 1.2 Architecture
- **Monorepo with 8 packages** under `packages/` (core, repo, discovery, budget, execution, completion, tracking, cli, dashboard).
- **Event bus backbone** (typed EventEmitter) decouples subsystems and powers SSE for the dashboard.
- **pnpm workspaces + Turborepo** for build orchestration.
- **TypeScript (ESM-only)** across all packages.
- **Git worktree isolation** for parallel agent execution -- no clone duplication, full sandbox.

### 1.3 Feature Set (v1.0)
All three documents agree on the 7-feature scope:
1. Repo Selection (clone, cache, metadata)
2. Task Discovery (lint, TODO, test-gap, dead-code, GitHub issues)
3. Token Budget Estimator (per-provider tokenization, knapsack selection)
4. Completion Handler (PR creation, issue linking, webhook notifications)
5. Parallel Execution (worker pool, job queue, retry logic)
6. Contribution Tracking (.oac/ JSON logs, leaderboard)
7. CLI + Dashboard (Commander.js CLI, embedded Fastify server, React SPA)

### 1.4 CLI Commands
All agree on the core command set: `init`, `scan`, `plan`, `run`, `status`, `log`, `leaderboard`, `config`, `dashboard`. Codex adds `doctor` for environment validation -- adopted.

### 1.5 Testing & Quality
- **Vitest** as the test framework.
- **Biome** for linting and formatting (replaces ESLint + Prettier).
- **80% coverage thresholds** for statements, functions, and lines.
- **Three test tiers:** unit, integration, E2E with mock agents.

---

## 2. Conflicts and Resolutions

### 2.1 Dashboard Framework

| Perspective | Choice | Rationale |
|-------------|--------|-----------|
| Claude | React + Vite (SPA) + Fastify server | Lightweight, pre-built, embedded in CLI |
| Gemini | Next.js (App Router) + shadcn/ui | Rich routing, SSR capability |
| Codex | Fastify + React + Vite (agrees with Claude), suggests Hono as alternative |

**Resolution: React + Vite SPA served by Fastify.** Next.js is overkill for a localhost dashboard embedded in a CLI process. There is no need for SSR -- the data comes from the local event bus, not a remote API. Fastify is the right balance of maturity and performance. Hono can be revisited in v0.2 if bundle size becomes a concern.

**Adopt from Gemini:** The shadcn/ui component library and Tailwind CSS for styling. The "Neon Operator" dark-mode color palette is excellent for a developer tool aesthetic.

### 2.2 CLI Rendering Library

| Perspective | Choice |
|-------------|--------|
| Claude | Ink (React for CLI) + chalk + ora |
| Gemini | Commander/Yargs + Inquirer/Prompts + chalk + ora + boxen + consola |
| Codex | Commander + chalk + ora + cli-table3 (defer Ink to v0.2) |

**Resolution: Start with Commander + chalk + ora + cli-table3 for v0.1.** Ink adds a React dependency to the CLI package, which increases install size and complexity. For v0.1, plain text output with spinners and tables is sufficient. Ink can be added in v0.2 for `oac status --watch` and richer multi-line output. Adopt `boxen` from Gemini for run summaries.

### 2.3 Metadata Cache

| Perspective | Choice |
|-------------|--------|
| Claude | better-sqlite3 |
| Codex | JSON file for v0.1, SQLite for v0.2 |
| Gemini | Not specified |

**Resolution: JSON file cache for v0.1, migrate to better-sqlite3 in v0.2.** The native compilation requirement of better-sqlite3 is a barrier for first-time users. A simple `~/.oac/cache/repos.json` with TTL fields is sufficient for v0.1. The interface should be designed so the storage backend is swappable.

### 2.4 Interactive Prompts for `oac init`

| Perspective | Approach |
|-------------|----------|
| Claude | Mentions interactive setup but no library choice |
| Gemini | Inquirer/Prompts with autocomplete |
| Codex | Shows exact terminal output mockup |

**Resolution: Use `@inquirer/prompts` (v6+, ESM-native).** The new modular Inquirer is tree-shakeable and ESM-compatible. Use it for `oac init` and `oac repo add` interactive flows.

### 2.5 Chart Library

| Perspective | Choice |
|-------------|--------|
| Gemini | Recharts |
| Claude | Not specified |
| Codex | Recharts |

**Resolution: Recharts.** Consensus from two perspectives, lightweight, React-native.

---

## 3. Recommended Tech Stack

| Concern | Technology | Version | Notes |
|---------|------------|---------|-------|
| **Runtime** | Node.js | >= 22 | LTS, native ESM |
| **Language** | TypeScript | >= 5.7 | Strict mode |
| **Package Manager** | pnpm | 9.15+ | Workspace protocol |
| **Monorepo** | Turborepo | 2.4+ | Incremental builds |
| **Bundler** | tsup | 8.3+ | esbuild-based |
| **Linter/Formatter** | Biome | 1.9+ | Single tool, fast |
| **Test Framework** | Vitest | 3.0+ | ESM-native, v8 coverage |
| **CLI Framework** | Commander.js | 13.1+ | Typed, subcommands |
| **CLI Output** | chalk + ora + cli-table3 | latest | v0.1 rendering |
| **Interactive Prompts** | @inquirer/prompts | 6+ | ESM-native |
| **GitHub API** | @octokit/rest | 21+ | Official SDK |
| **Git Operations** | simple-git | 3.27+ | Promise-based |
| **Event Bus** | eventemitter3 | 5.0+ | Typed, fast |
| **Job Queue** | p-queue | 8.1+ | Concurrency control |
| **Schema Validation** | zod | 3.24+ | Runtime + static types |
| **Token Counting** | tiktoken | 1.0+ | OpenAI tokenizer |
| **Process Execution** | execa | 9.5+ | Modern child_process |
| **Dashboard Server** | Fastify | 5.2+ | TypeScript-first |
| **Dashboard Client** | React + Vite | 19.0 / 6.1 | SPA, pre-built |
| **UI Components** | shadcn/ui + Tailwind | 4.0 (Tailwind) | Copy-paste, accessible |
| **Charts** | Recharts | 2.15+ | React-native D3 |
| **Terminal in Browser** | @xterm/xterm | 5.5+ | Agent output rendering |
| **Version Management** | Changesets | 2.27+ | Monorepo releases |

---

## 4. Implementation Roadmap

### v0.1 -- Foundation (Weeks 1-3)

**Goal:** Single repo, single agent, scan and run with CLI output.

| Week | Deliverables |
|------|-------------|
| 1 | Monorepo scaffold (pnpm, turbo, tsup, biome, vitest). Core package: event bus, config loader (zod), error types. CLI skeleton: `oac init`, `oac doctor`. |
| 2 | Repo package: resolver, shallow clone, JSON metadata cache. Discovery package: TODO scanner, lint scanner. Budget package: basic token estimator with tiktoken. |
| 3 | Execution package: single-worker engine (no parallelism), Claude Code adapter, git worktree sandbox. Completion package: PR creation via Octokit. Tracking package: contribution log writer. CLI: `oac scan`, `oac plan`, `oac run` (single-task). |

**Exit criteria:**
- `oac scan --repo owner/repo` discovers and displays tasks
- `oac run --repo owner/repo --tokens 50000` executes one task and creates a PR
- Contribution log is written to `.oac/`
- CI pipeline runs lint + typecheck + unit tests
- 80% test coverage on core, discovery, budget packages

### v0.2 -- Parallel & Multi-Scanner (Weeks 4-6)

**Goal:** Parallel execution, all scanners, multiple agents, contribution history.

| Week | Deliverables |
|------|-------------|
| 4 | Execution engine: parallel worker pool with p-queue, concurrency control, retry logic. Test-gap scanner, dead-code scanner, GitHub issue scanner. |
| 5 | Knapsack task selection algorithm. Multi-agent support: Codex CLI adapter. `oac plan` shows full budget breakdown. `oac status` with live job tracking. |
| 6 | `oac log` and `oac leaderboard` commands. Contribution log aggregation. `oac config get/set` commands. Integration tests for full scan-plan-run pipeline. |

**Exit criteria:**
- `oac run --concurrency 3` runs 3 agents in parallel
- All 5 scanners operational
- `oac log` shows contribution history
- Integration test: full pipeline with mock agent

### v0.3 -- Dashboard & Integrations (Weeks 7-9)

**Goal:** Web dashboard, webhook integrations, PR monitoring.

| Week | Deliverables |
|------|-------------|
| 7 | Dashboard server: Fastify with REST API endpoints + SSE stream. React SPA scaffold: Vite + Tailwind + shadcn/ui. Status page with live job cards. |
| 8 | Dashboard: task list view, budget gauge, contribution history, leaderboard. xterm.js agent output panel. "Start Run" and "Abort" controls from dashboard. |
| 9 | Linear webhook integration. Jira webhook integration. PR monitoring (poll for review status). `oac dashboard` command with `--open` flag. |

**Exit criteria:**
- `oac dashboard` opens a functional web UI
- Dashboard shows live SSE updates during `oac run`
- Linear/Jira notifications fire on PR creation
- E2E test: full run with dashboard open

### v0.4 -- Polish & Hardening (Weeks 10-12)

**Goal:** Production-ready CLI, security hardening, documentation.

| Week | Deliverables |
|------|-------------|
| 10 | Secret sanitization in all output paths. Diff validation (size limits, forbidden patterns, protected files). Fork-based PR support (no push permission). `oac doctor` expanded checks. |
| 11 | Error recovery improvements: partial result salvage, graceful SIGINT handling, crash reports. Performance: incremental scanning (only changed files). better-sqlite3 migration for metadata cache. |
| 12 | README, CLI help text polish, `--json` output for all commands. Changesets setup for npm publishing. Dogfood CI workflow. Release `v0.4.0` as public beta. |

**Exit criteria:**
- All security threat mitigations implemented
- Crash reports written on fatal errors
- All commands support `--json` output
- Published to npm as `@oac/cli`

### v1.0 -- General Availability (Weeks 13-16)

| Week | Deliverables |
|------|-------------|
| 13-14 | Plugin system: custom scanners, custom agents, lifecycle hooks. OpenCode adapter. Custom scanner documentation. |
| 15 | Dashboard gamification: badges, contribution graph (heatmap), export to PDF/CSV. `oac suggest` command (top-3 recommended tasks). |
| 16 | Performance audit, load testing with large repos (>1GB, sparse checkout). Final documentation pass. Release v1.0.0. |

---

## 5. Key Architectural Decisions (Summary)

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Monorepo structure | pnpm workspaces + Turborepo | Nx, Lerna | Turbo is simpler, pnpm is strict on deps |
| Agent isolation | Git worktrees | Docker containers, separate clones | Worktrees share .git objects (disk efficient), no Docker dependency |
| Event communication | Typed EventEmitter + SSE | WebSocket, polling | SSE is unidirectional (sufficient), simpler than WS |
| Dashboard framework | Fastify + React SPA | Next.js, Hono | No SSR needed; Fastify is mature + TypeScript-first |
| Config format | oac.config.ts (TypeScript) | JSON, YAML, TOML | TypeScript gives IDE autocompletion + type checking |
| Tracking storage | JSON files in .oac/ (git-tracked) | SQLite, PostgreSQL | Git-native, auditable, zero dependencies |
| Token estimation | Conservative (20% padding + 10% reserve) | Exact counting | Over-estimate is safer than under-estimate |
| Task selection | Greedy knapsack (priority/token ratio) | Dynamic programming, random | Greedy is O(n log n) and near-optimal for our case |
| Metadata cache | JSON file (v0.1), SQLite (v0.2+) | SQLite from start | Avoids node-gyp for initial install experience |

---

## 6. Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|------------|-------|
| Agent output format changes | High | High | Version-pinned adapters, integration tests with canned responses | Execution package |
| GitHub API rate limiting | Medium | Medium | Conditional requests, local cache, backoff | Repo package |
| Token estimation inaccuracy | High | Medium | 20% padding, 10% reserve, abort at 90% usage | Budget package |
| Large repo clone times | Medium | Low | Shallow clone default, sparse checkout for v1.0 | Repo package |
| better-sqlite3 build failures | Medium | Low | Deferred to v0.2, JSON cache for v0.1 | Repo package |
| Agent writes insecure code | Low | High | Diff validation, lint/test gates, human PR review | Completion package |
| Scope creep (too many features per phase) | High | Medium | Strict phase gates, exit criteria per milestone | Project lead |

---

## 7. Metrics for Success

### v0.1
- Time from `npm install -g @oac/cli` to first PR created: < 5 minutes
- Unit test coverage: >= 80%

### v0.4 (Public Beta)
- `oac scan` completes in < 30 seconds for repos under 100MB
- `oac run` with 3 concurrent agents stays under 2GB RAM
- Zero secret leakage in any output path

### v1.0
- Support >= 3 agent providers
- Plugin system allows community scanners
- Dogfood: OAC successfully creates mergeable PRs on itself

---

## 8. Open Decisions (Needs Team Input)

1. **npm scope:** `@oac/*` is assumed. Verify availability on npm registry before v0.4.
2. **Telemetry:** Claude's doc mentions `OAC_NO_TELEMETRY` env var. Decision needed: do we collect anonymous usage stats at all? Recommendation: no telemetry in v1.0, revisit for v2.0.
3. **Auto-merge support:** Should OAC ever auto-merge its own PRs? Current recommendation: never. Always require human review. But this could be configurable for trusted internal repos.
4. **Multi-repo parallel:** Architecture supports `--parallel-repos` but implementation complexity is high. Defer to post-v1.0 unless there is strong user demand.
5. **Ink adoption timeline:** v0.2 introduces `oac status --watch`. Decide then whether Ink's dependency weight is justified.

---

## 9. Document Cross-Reference

| Topic | Claude (Architecture) | Gemini (UX/DX) | Codex (Implementation) |
|-------|----------------------|-----------------|----------------------|
| System diagram | Section 2 | -- | -- |
| Monorepo structure | Section 3 | -- | Section 4 (package.json) |
| Agent interface | Section 4.1 | -- | Section 7.5 (mock agent) |
| Task interface | Section 4.2 | -- | -- |
| Repo selection | Section 5 | Section 2.1 | -- |
| Task discovery | Section 6 | Section 2.2 | -- |
| Token budget | Section 7 | Section 2.3 | -- |
| Completion handler | Section 8 | Section 2.4 | -- |
| Parallel execution | Section 9 | Section 2.5 | -- |
| Contribution tracking | Section 10 | Section 2.6 | -- |
| CLI commands | Section 11 | Section 3 | Section 2 (full tree) |
| Dashboard | Section 11 | Sections 2-3 | Section 3 (REST API) |
| Config system | Section 12 | -- | Section 5 (tsconfig) |
| Security | Section 13 | -- | -- |
| Error handling | Section 14 | -- | -- |
| Tech stack | Section 15 | Section 3 | Section 4 (versions) |
| Testing | -- | -- | Section 7 |
| CI/CD | -- | -- | Section 8 |
| Biome config | -- | -- | Section 9 |
| Onboarding flow | -- | Section 4 | Section 2.2 (oac init) |
| Accessibility | -- | Section 5 | -- |
| Color palette | -- | Section 1 | -- |
| Future roadmap | Section 17 | -- | Section 12 (open Qs) |

---

*This merged plan was synthesized from three independent planning perspectives. It serves as the authoritative decision document for OAC implementation. When details conflict between source documents, this document's resolutions take precedence.*
