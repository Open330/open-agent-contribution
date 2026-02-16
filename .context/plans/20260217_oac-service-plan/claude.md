# Open Agent Contribution (OAC) - System Architecture & Core Engine Design

**Author:** Claude (System Architecture Perspective)
**Date:** 2026-02-17
**Status:** Draft v1.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Overall System Architecture](#2-overall-system-architecture)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Core Abstractions](#4-core-abstractions)
5. [Feature 1: Repo Selection](#5-feature-1-repo-selection)
6. [Feature 2: Task Discovery Engine](#6-feature-2-task-discovery-engine)
7. [Feature 3: Token Budget Estimator](#7-feature-3-token-budget-estimator)
8. [Feature 4: Completion Handler](#8-feature-4-completion-handler)
9. [Feature 5: Parallel Execution](#9-feature-5-parallel-execution)
10. [Feature 6: Contribution Tracking](#10-feature-6-contribution-tracking)
11. [Feature 7: CLI + Dashboard](#11-feature-7-cli--dashboard)
12. [Configuration System](#12-configuration-system)
13. [Security Architecture](#13-security-architecture)
14. [Error Handling Strategy](#14-error-handling-strategy)
15. [Technology Stack](#15-technology-stack)
16. [Integration Map](#16-integration-map)
17. [Future Considerations](#17-future-considerations)

---

## 1. Executive Summary

OAC is a local-first CLI tool and optional web dashboard that lets developers reclaim value from unused AI agent tokens by automatically discovering and executing contribution tasks against GitHub repositories. The system orchestrates multiple AI agent providers (Claude Code, Codex CLI, OpenCode, etc.) through a unified interface, discovers actionable tasks in target repos, estimates token costs, executes contributions in parallel, and tracks all activity through a git-native audit trail.

### Design Principles

- **Local-first:** All orchestration runs on the developer's machine. No hosted backend required.
- **Provider-agnostic:** The agent interface is an abstraction over any CLI-based AI agent.
- **Git-native:** All tracking, auditing, and state management uses git as the source of truth.
- **Fail-safe:** Every operation is idempotent and recoverable. No contribution is merged without validation.
- **Token-conscious:** Every operation is budgeted before execution. The system never silently exhausts tokens.

---

## 2. Overall System Architecture

### High-Level Component Diagram

```
+------------------------------------------------------------------+
|                        OAC CLI / Dashboard                       |
|  (Commander.js CLI  |  localhost Vite+React Dashboard via SSE)   |
+----------------------------------+-------------------------------+
                                   |
                    +------------- v --------------+
                    |       OAC Core Engine         |
                    |  (Orchestrator / Event Bus)   |
                    +----+----+----+----+----+-----+
                         |    |    |    |    |
          +--------------+    |    |    |    +--------------+
          |                   |    |    |                   |
+---------v------+  +---------v--+ | +--v---------+ +------v---------+
| Repo Selection |  | Task       | | | Token      | | Contribution   |
| Service        |  | Discovery  | | | Budget     | | Tracking       |
|                |  | Engine     | | | Estimator  | | Service        |
+----------------+  +------------+ | +------------+ +----------------+
                                   |
                    +--------------v---------------+
                    |     Execution Engine          |
                    |  (Agent Pool + Job Queue)     |
                    +----+----+----+----+----------+
                         |    |    |    |
                 +-------+  +-+  ++  +-+-------+
                 |          |    |    |         |
           +-----v---+ +---v--+ +v---+-+ +-----v------+
           | Claude   | |Codex | |Open | | Completion  |
           | Code     | |CLI   | |Code | | Handler     |
           | Adapter  | |Adapt.| |Ad.  | | (PR/Issue)  |
           +----------+ +------+ +-----+ +------------+
                                              |
                                    +---------v----------+
                                    | GitHub API         |
                                    | Linear/Jira Hooks  |
                                    +--------------------+
```

### Data Flow (Happy Path)

```
1. User runs `oac run --repo owner/repo --tokens 50000`
2. Repo Selection resolves repo, clones/pulls, caches metadata
3. Task Discovery scans codebase + GitHub issues, produces ranked TaskList
4. Token Budget Estimator scores each task for feasibility within budget
5. Orchestrator selects top N tasks that fit within budget
6. Execution Engine spawns agent workers (up to concurrency limit)
7. Each agent worker:
   a. Checks out a fresh branch
   b. Invokes the AI agent CLI with the task prompt
   c. Validates output (lint, test, diff size)
   d. Creates PR via GitHub API
8. Completion Handler manages PR lifecycle, closes linked issues
9. Contribution Tracking writes log entry to .oac/ directory
10. Dashboard/CLI shows real-time progress and summary
```

### Event Bus Architecture

The core engine uses a typed EventEmitter (via `mitt` or `eventemitter3`) as the internal communication backbone. This decouples all subsystems and enables the dashboard's real-time SSE stream.

```typescript
type OacEvents = {
  'repo:resolved':       { repo: ResolvedRepo };
  'repo:clone:progress': { repo: string; percent: number };
  'task:discovered':     { tasks: Task[] };
  'task:selected':       { task: Task; reason: string };
  'budget:estimated':    { task: Task; estimate: TokenEstimate };
  'execution:started':   { jobId: string; task: Task; agent: string };
  'execution:progress':  { jobId: string; tokensUsed: number; stage: string };
  'execution:completed': { jobId: string; result: ExecutionResult };
  'execution:failed':    { jobId: string; error: OacError };
  'pr:created':          { jobId: string; prUrl: string };
  'pr:merged':           { jobId: string; prUrl: string };
  'run:completed':       { summary: RunSummary };
};
```

---

## 3. Monorepo Structure

```
open-agent-contribution/
├── packages/
│   ├── core/                    # Core engine, orchestrator, event bus
│   │   ├── src/
│   │   │   ├── orchestrator.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── repo/                    # Repo selection, cloning, metadata
│   │   ├── src/
│   │   │   ├── resolver.ts
│   │   │   ├── cloner.ts
│   │   │   ├── metadata-cache.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── discovery/               # Task discovery engine
│   │   ├── src/
│   │   │   ├── scanner.ts       # Composite scanner orchestrator
│   │   │   ├── scanners/
│   │   │   │   ├── lint-scanner.ts
│   │   │   │   ├── todo-scanner.ts
│   │   │   │   ├── test-gap-scanner.ts
│   │   │   │   ├── dead-code-scanner.ts
│   │   │   │   └── issue-scanner.ts
│   │   │   ├── ranker.ts        # Priority scoring algorithm
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── budget/                  # Token budget estimator
│   │   ├── src/
│   │   │   ├── estimator.ts
│   │   │   ├── providers/
│   │   │   │   ├── claude-counter.ts
│   │   │   │   ├── codex-counter.ts
│   │   │   │   └── opencode-counter.ts
│   │   │   ├── complexity.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── execution/               # Parallel execution engine
│   │   ├── src/
│   │   │   ├── engine.ts        # Job queue + worker pool
│   │   │   ├── worker.ts        # Single agent worker
│   │   │   ├── agents/
│   │   │   │   ├── agent.interface.ts
│   │   │   │   ├── claude-code.adapter.ts
│   │   │   │   ├── codex-cli.adapter.ts
│   │   │   │   └── opencode.adapter.ts
│   │   │   ├── sandbox.ts       # Git worktree isolation
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── completion/              # PR/Issue lifecycle, webhooks
│   │   ├── src/
│   │   │   ├── handler.ts
│   │   │   ├── github-pr.ts
│   │   │   ├── issue-linker.ts
│   │   │   ├── webhooks/
│   │   │   │   ├── linear.ts
│   │   │   │   └── jira.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── tracking/                # .oac/ contribution tracking
│   │   ├── src/
│   │   │   ├── logger.ts
│   │   │   ├── log-schema.ts
│   │   │   ├── leaderboard.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── cli/                     # CLI application
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── run.ts
│   │   │   │   ├── scan.ts
│   │   │   │   ├── status.ts
│   │   │   │   ├── log.ts
│   │   │   │   └── config.ts
│   │   │   ├── cli.ts
│   │   │   └── index.ts
│   │   ├── bin/
│   │   │   └── oac.ts
│   │   └── package.json
│   │
│   └── dashboard/               # Localhost web dashboard
│       ├── src/
│       │   ├── server/
│       │   │   ├── sse.ts       # SSE event stream
│       │   │   └── api.ts       # REST endpoints
│       │   ├── client/          # React SPA
│       │   │   ├── App.tsx
│       │   │   ├── components/
│       │   │   └── hooks/
│       │   └── index.ts
│       └── package.json
│
├── .oac/                        # Self-tracking (OAC contributing to OAC)
│   └── contributions/
├── oac.config.ts                # Default config for self-development
├── package.json                 # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
└── turbo.json                   # Turborepo pipeline config
```

### Build & Package Tooling

| Concern | Tool | Rationale |
|---------|------|-----------|
| Package manager | pnpm | Strict dependency resolution, workspace protocol, disk efficiency |
| Monorepo orchestration | Turborepo | Incremental builds, remote caching, pipeline parallelism |
| TypeScript build | tsup | Fast esbuild-based bundling for each package |
| Testing | Vitest | Fast, ESM-native, compatible with TypeScript paths |
| Linting | Biome | Single tool for lint + format, much faster than ESLint+Prettier |

---

## 4. Core Abstractions

### 4.1 Agent Interface

This is the most critical abstraction. Every AI agent provider must implement this interface. The design is intentionally stream-oriented to support real-time token tracking and progress reporting.

```typescript
// packages/execution/src/agents/agent.interface.ts

/** Represents a single AI agent provider (Claude Code, Codex, etc.) */
export interface AgentProvider {
  /** Unique identifier for this provider */
  readonly id: AgentProviderId;

  /** Human-readable name */
  readonly name: string;

  /** Check if the agent CLI is installed and authenticated */
  checkAvailability(): Promise<AgentAvailability>;

  /** Execute a task prompt in the given working directory */
  execute(params: AgentExecuteParams): AgentExecution;

  /** Estimate token cost for a given prompt + context size */
  estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;

  /** Abort a running execution */
  abort(executionId: string): Promise<void>;
}

export type AgentProviderId = 'claude-code' | 'codex-cli' | 'opencode' | string;

export interface AgentAvailability {
  available: boolean;
  version?: string;
  error?: string;
  /** Remaining tokens/credits if queryable */
  remainingBudget?: number;
}

export interface AgentExecuteParams {
  executionId: string;
  workingDirectory: string;
  prompt: string;
  /** Files the agent should focus on */
  targetFiles: string[];
  /** Maximum tokens this execution may consume */
  tokenBudget: number;
  /** Whether the agent may make git commits */
  allowCommits: boolean;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Environment variables to inject */
  env?: Record<string, string>;
}

/** Represents a running agent execution (streaming) */
export interface AgentExecution {
  readonly executionId: string;
  readonly providerId: AgentProviderId;

  /** Stream of events from the agent process */
  events: AsyncIterable<AgentEvent>;

  /** Promise that resolves when execution completes */
  result: Promise<AgentResult>;

  /** The underlying child process PID (for emergency kill) */
  pid?: number;
}

export type AgentEvent =
  | { type: 'output'; content: string; stream: 'stdout' | 'stderr' }
  | { type: 'tokens'; inputTokens: number; outputTokens: number; cumulativeTokens: number }
  | { type: 'file_edit'; path: string; action: 'create' | 'modify' | 'delete' }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'error'; message: string; recoverable: boolean };

export interface AgentResult {
  success: boolean;
  exitCode: number;
  totalTokensUsed: number;
  filesChanged: string[];
  duration: number;
  error?: string;
}
```

### 4.2 Task Interface

```typescript
// packages/discovery/src/task.interface.ts

export interface Task {
  /** Stable unique ID derived from content hash */
  id: string;

  /** Which scanner discovered this task */
  source: TaskSource;

  /** Human-readable title */
  title: string;

  /** Detailed description suitable as an agent prompt */
  description: string;

  /** The files primarily involved */
  targetFiles: string[];

  /** Priority score (0-100, higher = more valuable) */
  priority: number;

  /** Estimated complexity */
  complexity: TaskComplexity;

  /** How this task should be contributed */
  executionMode: ExecutionMode;

  /** Optional link to GitHub issue */
  linkedIssue?: {
    number: number;
    url: string;
    labels: string[];
  };

  /** Metadata from the scanner */
  metadata: Record<string, unknown>;

  /** When this task was discovered */
  discoveredAt: string; // ISO 8601
}

export type TaskSource =
  | 'lint'
  | 'todo'
  | 'test-gap'
  | 'dead-code'
  | 'github-issue'
  | 'github-pr-review'
  | 'custom';

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export type ExecutionMode =
  | 'new-pr'          // Create a new pull request
  | 'update-pr'       // Push to an existing PR branch
  | 'direct-commit';  // Commit to default branch (requires write access + config flag)
```

### 4.3 Provider Interface (for External Integrations)

```typescript
// packages/completion/src/provider.interface.ts

/** Abstraction for project management tool integrations */
export interface ProjectManagementProvider {
  readonly id: string;
  readonly name: string;

  /** Test connectivity */
  ping(): Promise<boolean>;

  /** Notify that work has started on a task */
  notifyStarted(ref: ExternalTaskRef): Promise<void>;

  /** Notify that a PR has been created */
  notifyPRCreated(ref: ExternalTaskRef, prUrl: string): Promise<void>;

  /** Notify that the task is complete */
  notifyCompleted(ref: ExternalTaskRef, result: CompletionResult): Promise<void>;

  /** Notify that the task failed */
  notifyFailed(ref: ExternalTaskRef, error: string): Promise<void>;
}

export interface ExternalTaskRef {
  provider: string;       // 'linear' | 'jira' | 'github'
  externalId: string;     // e.g., 'ENG-123', 'PROJ-456', '#42'
  url?: string;
}

export interface CompletionResult {
  prUrl?: string;
  commitSha?: string;
  summary: string;
  filesChanged: number;
  tokensUsed: number;
}
```

---

## 5. Feature 1: Repo Selection

### Architecture

```
User Input                  Repo Resolver              GitHub API
("owner/repo" | URL)   -->  parse + validate  -------> GET /repos/:owner/:repo
                                  |                         |
                                  v                         v
                            Metadata Cache            Repo Metadata
                            (SQLite / JSON)       (language, size, license,
                                  |                default branch, topics)
                                  v
                            Local Clone Manager
                            (git clone --depth=1 or git pull)
                                  |
                                  v
                            ResolvedRepo object
```

### Key Design Decisions

1. **Shallow clone by default:** `git clone --depth=1` for initial scan. Full history only fetched if needed (e.g., dead code detection via git log). Tradeoff: faster startup vs. incomplete history for some scanners.

2. **Worktree-based isolation:** The main clone is kept clean. Each agent execution gets a `git worktree` for its branch. This avoids clone duplication while providing full isolation.

3. **Metadata caching:** Repo metadata is cached in `~/.oac/cache/repos.sqlite` with a TTL of 1 hour. This avoids hammering the GitHub API on repeated runs.

4. **Multi-repo support:** The config file accepts an array of repos. The orchestrator processes them sequentially by default, or in parallel with `--parallel-repos`.

### Data Model

```typescript
export interface ResolvedRepo {
  /** GitHub owner/repo */
  fullName: string;
  owner: string;
  name: string;

  /** Local filesystem path to the clone */
  localPath: string;

  /** Path to the primary worktree for this run */
  worktreePath: string;

  /** GitHub metadata */
  meta: {
    defaultBranch: string;
    language: string | null;
    languages: Record<string, number>; // language -> bytes
    size: number;                       // KB
    stars: number;
    openIssuesCount: number;
    topics: string[];
    license: string | null;
    isArchived: boolean;
    isFork: boolean;
    permissions: {
      push: boolean;
      pull: boolean;
      admin: boolean;
    };
  };

  /** Resolved git state */
  git: {
    headSha: string;
    remoteUrl: string;
    isShallowClone: boolean;
  };
}
```

### Error Handling

| Error | Handling |
|-------|----------|
| Repo not found (404) | Fail fast with clear message. Suggest checking spelling. |
| No push permission | Warn, switch execution mode to fork-based PRs. |
| Archived repo | Fail fast. Cannot contribute to archived repos. |
| Clone fails (network) | Retry 3 times with exponential backoff (1s, 4s, 16s). |
| Disk space insufficient | Pre-check: estimate clone size from `meta.size`, warn if < 2x available. |
| Rate limit (GitHub API) | Respect `X-RateLimit-Remaining`. Queue requests. Use conditional requests (`If-None-Match`). |

### Integration Points

- **Task Discovery** consumes `ResolvedRepo.localPath` for codebase scanning
- **Task Discovery** consumes `ResolvedRepo.meta` for issue scanning
- **Execution Engine** uses `ResolvedRepo.worktreePath` to create per-task worktrees
- **Completion Handler** uses `ResolvedRepo.fullName` and `meta.permissions` for PR creation

---

## 6. Feature 2: Task Discovery Engine

### Architecture

```
ResolvedRepo
     |
     v
+--------------------+
| Composite Scanner  |  (orchestrates all scanners in parallel)
+----+----+----+----++
     |    |    |    |
     v    v    v    v
  +----+ +----+ +------+ +--------+  +-------------+
  |Lint| |TODO| |Test  | |Dead    |  |GitHub Issue |
  |Scan| |Scan| |Gap   | |Code    |  |Scanner      |
  |    | |    | |Scan  | |Scanner |  |(API-based)  |
  +--+-+ +--+-+ +--+---+ +---+----+  +------+------+
     |      |      |          |              |
     v      v      v          v              v
  +--------------------------------------------------+
  |              Raw Task Collector                   |
  +--------------------------------------------------+
                         |
                         v
  +--------------------------------------------------+
  |              Deduplication Engine                 |
  |  (content-hash based, merge overlapping tasks)   |
  +--------------------------------------------------+
                         |
                         v
  +--------------------------------------------------+
  |              Priority Ranker                      |
  |  (multi-factor scoring algorithm)                |
  +--------------------------------------------------+
                         |
                         v
                   Ranked Task[]
```

### Scanner Specifications

#### Lint Scanner
- **Input:** `ResolvedRepo.localPath`, detected package manager, existing lint config
- **Method:** Run the repo's own linter (`npm run lint`, `cargo clippy`, etc.) and parse structured output (ESLint JSON formatter, etc.). If no linter configured, use Biome with default rules.
- **Output:** One task per file or per lint category (configurable grouping).
- **Complexity mapping:** Single auto-fixable rule = `trivial`. Multiple rules in one file = `simple`. Cross-file issues = `moderate`.

#### TODO Scanner
- **Input:** `ResolvedRepo.localPath`
- **Method:** Ripgrep for `TODO`, `FIXME`, `HACK`, `XXX` patterns. Parse surrounding context (function name, file path, nearby comments).
- **Output:** One task per TODO cluster (TODOs within 10 lines of each other are grouped).
- **Complexity mapping:** Single-line TODO = `trivial`. Multi-line or cross-reference = `simple`/`moderate`.

#### Test Gap Scanner
- **Input:** `ResolvedRepo.localPath`, detected test framework
- **Method:**
  1. Enumerate source files and test files.
  2. Compute coverage map: which source files have corresponding test files.
  3. For files with tests: if coverage data is available (e.g., `coverage/lcov.info`), identify uncovered functions.
  4. For files without tests: generate a "write tests for X" task.
- **Output:** One task per untested file or uncovered function cluster.
- **Complexity mapping:** Unit test for pure function = `simple`. Integration test = `moderate`. E2E = `complex`.

#### Dead Code Scanner
- **Input:** `ResolvedRepo.localPath` (may need full git history)
- **Method:**
  1. Static analysis: Use `ts-prune` (TypeScript), `vulture` (Python), or tree-sitter based analysis for exported-but-unused symbols.
  2. Optionally: `git log --diff-filter=M` to find files not modified in >1 year.
- **Output:** One task per dead code cluster.
- **Complexity mapping:** Unused export = `trivial`. Unused module = `simple`. Entangled dead code = `moderate`.

#### GitHub Issue Scanner
- **Input:** `ResolvedRepo.fullName`, GitHub token
- **Method:**
  1. Fetch open issues via `GET /repos/:owner/:repo/issues?state=open&labels=good-first-issue,help-wanted,bug&per_page=100`
  2. Filter by labels configurable in `.oacrc` (default: `good-first-issue`, `help-wanted`, `bug`, `enhancement`)
  3. Parse issue body for actionable information.
  4. Exclude issues already assigned or with linked PRs.
- **Output:** One task per qualifying issue.
- **Complexity mapping:** `good-first-issue` = `simple`. `bug` = `moderate`. `enhancement` = `complex` (unless small).

### Priority Scoring Algorithm

Each task receives a score from 0-100 computed as a weighted sum:

```typescript
interface PriorityWeights {
  impactScore: number;       // 0-25: How much does this improve the codebase?
  feasibilityScore: number;  // 0-25: How likely is the agent to succeed?
  freshnessScore: number;    // 0-15: How recently was this area modified?
  issueSignals: number;      // 0-15: Upvotes, labels, maintainer comments
  tokenEfficiency: number;   // 0-20: Value per token spent
}

function computePriority(task: Task, weights: PriorityWeights): number {
  // Impact: lint fixes and test gaps > dead code > TODOs
  // Feasibility: trivial/simple tasks score higher
  // Freshness: recently modified files = more relevant
  // Issue signals: more upvotes/reactions = higher priority
  // Token efficiency: (estimated impact) / (estimated tokens)
  return (
    weights.impactScore +
    weights.feasibilityScore +
    weights.freshnessScore +
    weights.issueSignals +
    weights.tokenEfficiency
  );
}
```

### Deduplication

Tasks are deduplicated using a content-addressable hash:

```typescript
function taskContentHash(task: Task): string {
  const content = [
    task.source,
    task.targetFiles.sort().join(','),
    task.title,
  ].join('::');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
```

If two scanners find the same issue (e.g., a TODO that's also a lint warning), the higher-priority one wins and the other is merged as metadata.

### Error Handling

| Error | Handling |
|-------|----------|
| Linter not installed | Skip lint scanner, log warning, continue with other scanners. |
| No scanners produce tasks | Return empty list. CLI shows "No tasks discovered" with suggestions. |
| Scanner timeout (>60s) | Kill scanner, log partial results if any, continue with others. |
| GitHub API rate limit | Use conditional requests. If exhausted, skip issue scanner. |
| Malformed TODO pattern | Use strict regex. Log and skip unparseable matches. |

### Integration Points

- **Repo Selection** provides `ResolvedRepo` (local path + metadata)
- **Token Budget Estimator** consumes `Task[]` for cost estimation
- **Execution Engine** consumes selected `Task[]` for agent execution
- **Tracking** receives task IDs for contribution log correlation

---

## 7. Feature 3: Token Budget Estimator

### Architecture

```
Task[]  +  AgentProvider  +  UserBudget
          |
          v
  +-------------------+
  | Complexity Analyzer|
  | (AST depth, LOC,  |
  |  dependency count) |
  +--------+----------+
           |
           v
  +-------------------+
  | Provider Token     |
  | Counter            |
  | (tiktoken / est.)  |
  +--------+----------+
           |
           v
  +-------------------+
  | Feasibility Scorer |
  | (budget fit,       |
  |  confidence level) |
  +--------+----------+
           |
           v
  TokenEstimate per Task
  +  ExecutionPlan (ordered list of tasks that fit budget)
```

### Token Estimation Model

Token costs are estimated as:

```
total_tokens = context_tokens + prompt_tokens + expected_output_tokens

where:
  context_tokens  = file_content_tokens(targetFiles) + repo_structure_tokens
  prompt_tokens   = task_description_tokens + system_prompt_overhead
  expected_output_tokens = f(complexity, file_count, estimated_diff_size)
```

The `expected_output_tokens` multiplier varies by complexity:

| Complexity | Output Multiplier | Rationale |
|-----------|-------------------|-----------|
| `trivial` | 0.5x context | Mostly mechanical changes |
| `simple` | 1.0x context | Moderate reasoning + edits |
| `moderate` | 2.0x context | Significant reasoning + multi-file edits |
| `complex` | 3.5x context | Deep reasoning + architectural changes |

### Provider-Specific Counting

```typescript
// packages/budget/src/providers/claude-counter.ts

export class ClaudeTokenCounter implements TokenCounter {
  /** Claude uses a tiktoken-compatible tokenizer */
  countTokens(text: string): number {
    // Use @anthropic-ai/tokenizer or tiktoken with cl100k_base
    return encode(text).length;
  }

  /** Claude Code has specific overhead per invocation */
  get invocationOverhead(): number {
    return 1500; // system prompt + tool definitions
  }

  /** Claude Code's max context window */
  get maxContextTokens(): number {
    return 200_000; // Claude's context window
  }
}
```

### Data Model

```typescript
export interface TokenEstimate {
  taskId: string;
  providerId: AgentProviderId;

  /** Breakdown */
  contextTokens: number;
  promptTokens: number;
  expectedOutputTokens: number;
  totalEstimatedTokens: number;

  /** Confidence in the estimate (0-1) */
  confidence: number;

  /** Whether this task fits within the remaining budget */
  feasible: boolean;

  /** Estimated cost in USD (if pricing is known) */
  estimatedCostUsd?: number;
}

export interface ExecutionPlan {
  /** Total budget provided by user */
  totalBudget: number;

  /** Tasks selected for execution, in priority order */
  selectedTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    cumulativeBudgetUsed: number;
  }>;

  /** Tasks that were discovered but didn't fit the budget */
  deferredTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    reason: 'budget_exceeded' | 'low_confidence' | 'too_complex';
  }>;

  /** Budget reserved for retries and overhead (10% default) */
  reserveTokens: number;

  /** Remaining budget after selection */
  remainingTokens: number;
}
```

### Knapsack Selection Algorithm

Task selection is a variant of the 0/1 knapsack problem optimizing for total priority within the token budget:

```typescript
function selectTasks(
  tasks: Task[],
  estimates: Map<string, TokenEstimate>,
  budget: number,
  reservePercent: number = 0.10
): ExecutionPlan {
  const effectiveBudget = budget * (1 - reservePercent);
  const reserveTokens = budget - effectiveBudget;

  // Filter to feasible tasks only
  const feasible = tasks
    .filter(t => {
      const est = estimates.get(t.id)!;
      return est.feasible && est.confidence >= 0.5;
    })
    .sort((a, b) => {
      // Sort by priority-to-token ratio (greedy approximation)
      const ratioA = a.priority / estimates.get(a.id)!.totalEstimatedTokens;
      const ratioB = b.priority / estimates.get(b.id)!.totalEstimatedTokens;
      return ratioB - ratioA;
    });

  // Greedy selection
  const selected: ExecutionPlan['selectedTasks'] = [];
  let used = 0;

  for (const task of feasible) {
    const est = estimates.get(task.id)!;
    if (used + est.totalEstimatedTokens <= effectiveBudget) {
      used += est.totalEstimatedTokens;
      selected.push({ task, estimate: est, cumulativeBudgetUsed: used });
    }
  }

  // ... build deferred list from remaining tasks

  return { totalBudget: budget, selectedTasks: selected, deferredTasks, reserveTokens, remainingTokens: effectiveBudget - used };
}
```

The 10% reserve ensures budget for retries if an agent execution fails partway through.

### Key Design Decisions

1. **Conservative estimation:** Always overestimate by 20% rather than underestimate. Running out of tokens mid-task is worse than leaving some unused.
2. **Provider-specific tokenizers:** Each provider has its own tokenizer. Claude uses tiktoken/Anthropic tokenizer. Codex uses OpenAI's tiktoken. Fallback: character count / 4.
3. **Confidence scoring:** Estimates for `trivial` tasks have 0.9 confidence. `complex` tasks have 0.4. Low-confidence estimates are penalized in selection.

### Error Handling

| Error | Handling |
|-------|----------|
| Tokenizer unavailable | Fallback to chars/4 heuristic with 0.5 confidence |
| Budget too small for any task | Return empty plan with explanation of minimum budget needed |
| File too large for context window | Split task or mark as infeasible |
| Budget exceeded mid-execution | Agent adapter monitors token stream, aborts when 90% of task budget consumed |

---

## 8. Feature 4: Completion Handler

### Architecture

```
ExecutionResult
       |
       v
+------------------+
| Diff Validator   |  (lint check, test run, diff size limits)
+--------+---------+
         |
    pass | fail
    +----+----+
    |         |
    v         v
+--------+ +----------+
|PR Maker| |Rollback  |
|        | |& Report  |
+---+----+ +----------+
    |
    v
+------------------+
| Issue Linker     |  (parse "Fixes #N" from task, add to PR body)
+--------+---------+
         |
         v
+------------------+
| Webhook Notifier |  (Linear, Jira, Slack)
+--------+---------+
         |
         v
+------------------+
| PR Monitor       |  (poll for review comments, merge status)
+------------------+
```

### PR Creation Flow

```typescript
export interface PRCreationParams {
  repo: ResolvedRepo;
  task: Task;
  result: AgentResult;
  branchName: string;
  baseBranch: string;
}

async function createPR(params: PRCreationParams): Promise<CreatedPR> {
  const { repo, task, result, branchName, baseBranch } = params;

  // 1. Push the branch
  await git.push(repo.localPath, 'origin', branchName);

  // 2. Build PR body
  const body = buildPRBody(task, result);

  // 3. Create PR via GitHub API
  const pr = await octokit.pulls.create({
    owner: repo.owner,
    repo: repo.name,
    title: `[OAC] ${task.title}`,
    body,
    head: branchName,
    base: baseBranch,
    draft: false, // configurable
  });

  // 4. Add labels
  await octokit.issues.addLabels({
    owner: repo.owner,
    repo: repo.name,
    issue_number: pr.data.number,
    labels: ['oac-contribution', task.source],
  });

  // 5. Link issues
  if (task.linkedIssue) {
    // GitHub auto-links "Fixes #N" in PR body
    // Also add explicit reference comment
    await octokit.issues.createComment({
      owner: repo.owner,
      repo: repo.name,
      issue_number: task.linkedIssue.number,
      body: `OAC has opened a PR to address this issue: ${pr.data.html_url}`,
    });
  }

  return {
    number: pr.data.number,
    url: pr.data.html_url,
    sha: pr.data.head.sha,
  };
}
```

### PR Body Template

```markdown
## Summary

{{task.description}}

## Changes

{{diffSummary}}

- **Files changed:** {{result.filesChanged.length}}
- **Lines added:** {{additions}}
- **Lines removed:** {{deletions}}

## Context

- **Task source:** {{task.source}}
- **Agent:** {{agent.name}} {{agent.version}}
- **Tokens used:** {{result.totalTokensUsed}}
- **Execution time:** {{result.duration}}s

{{#if task.linkedIssue}}
Fixes #{{task.linkedIssue.number}}
{{/if}}

---
*This PR was automatically generated by [OAC](https://github.com/open330/open-agent-contribution) using leftover AI agent tokens.*
```

### Webhook Integration

```typescript
// packages/completion/src/webhooks/linear.ts

export class LinearWebhook implements ProjectManagementProvider {
  readonly id = 'linear';
  readonly name = 'Linear';

  constructor(private apiKey: string, private teamId: string) {}

  async notifyPRCreated(ref: ExternalTaskRef, prUrl: string): Promise<void> {
    // Linear API: Update issue status and add comment
    await this.client.issueUpdate(ref.externalId, {
      stateId: await this.getStateId('In Review'),
    });
    await this.client.commentCreate({
      issueId: ref.externalId,
      body: `OAC created a PR: ${prUrl}`,
    });
  }

  async notifyCompleted(ref: ExternalTaskRef, result: CompletionResult): Promise<void> {
    await this.client.issueUpdate(ref.externalId, {
      stateId: await this.getStateId('Done'),
    });
  }
}
```

### PR Monitor (Optional Background Process)

After PRs are created, the completion handler can optionally monitor them:

```typescript
export interface PRMonitorConfig {
  /** How often to poll for updates (seconds) */
  pollInterval: number; // default: 300 (5 min)

  /** Auto-respond to review comments using AI agent */
  autoRespondToReviews: boolean; // default: false

  /** Auto-delete branch after merge */
  autoDeleteBranch: boolean; // default: true

  /** Maximum time to monitor a PR before giving up (hours) */
  maxMonitorHours: number; // default: 168 (1 week)
}
```

### Error Handling

| Error | Handling |
|-------|----------|
| Push rejected (force push protection) | Rebase on latest base branch and retry once |
| PR creation fails (branch conflict) | Append timestamp to branch name and retry |
| Lint/test validation fails | Do not create PR, log failure, report to user |
| Issue already closed | Skip issue linking, still create PR |
| Webhook delivery fails | Log warning, continue (non-blocking) |
| No push permission | Fork the repo, create PR from fork |

---

## 9. Feature 5: Parallel Execution

### Architecture

```
ExecutionPlan.selectedTasks
            |
            v
    +-------+--------+
    |   Job Queue     |  (priority queue, FIFO within same priority)
    |   (in-memory)   |
    +---+---+---+----+
        |   |   |
        v   v   v
    +---+---+---+---+
    |  Worker Pool   |  (configurable concurrency, default: 2)
    +---+---+---+---+
        |   |   |
        v   v   v
    Agent  Agent  Agent
    Exec1  Exec2  Exec3
    (worktree1) (worktree2) (worktree3)
        |   |   |
        v   v   v
    +---+---+---+---+
    | Result Collector|
    | (event-driven)  |
    +----------------+
```

### Job Queue Implementation

```typescript
// packages/execution/src/engine.ts

export interface Job {
  id: string;
  task: Task;
  estimate: TokenEstimate;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;     // default: 2
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: ExecutionResult;
  error?: OacError;
  workerId?: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'aborted';

export class ExecutionEngine {
  private queue: PriorityQueue<Job>;
  private workers: Map<string, Worker>;
  private activeJobs: Map<string, Job>;
  private concurrency: number;

  constructor(
    private agents: AgentProvider[],
    private eventBus: OacEventBus,
    config: ExecutionConfig,
  ) {
    this.concurrency = config.concurrency ?? 2;
    this.queue = new PriorityQueue((a, b) => b.task.priority - a.task.priority);
    this.workers = new Map();
    this.activeJobs = new Map();
  }

  /** Enqueue all tasks from the execution plan */
  enqueue(plan: ExecutionPlan): void {
    for (const { task, estimate } of plan.selectedTasks) {
      this.queue.push({
        id: randomUUID(),
        task,
        estimate,
        status: 'queued',
        attempts: 0,
        maxAttempts: 2,
        createdAt: Date.now(),
      });
    }
  }

  /** Start processing the queue */
  async run(): Promise<RunResult> {
    const results: ExecutionResult[] = [];

    while (!this.queue.isEmpty() || this.activeJobs.size > 0) {
      // Fill workers up to concurrency limit
      while (this.activeJobs.size < this.concurrency && !this.queue.isEmpty()) {
        const job = this.queue.pop()!;
        this.startJob(job);
      }

      // Wait for any job to complete
      const completed = await this.waitForAnyCompletion();
      results.push(completed);

      // If failed and retriable, re-enqueue
      if (completed.status === 'failed' && completed.attempts < completed.maxAttempts) {
        completed.status = 'retrying';
        completed.attempts++;
        this.queue.push(completed);
      }
    }

    return this.summarize(results);
  }

  /** Emergency stop all running agents */
  async abort(): Promise<void> {
    for (const [jobId, job] of this.activeJobs) {
      const agent = this.agents.find(a => a.id === job.workerId);
      await agent?.abort(jobId);
    }
    this.activeJobs.clear();
    this.queue.clear();
  }
}
```

### Worker Isolation via Git Worktrees

Each concurrent agent execution gets its own git worktree to avoid conflicts:

```typescript
// packages/execution/src/sandbox.ts

export class Sandbox {
  /**
   * Create an isolated working directory for an agent execution.
   * Uses git worktree for efficiency (shares .git objects).
   */
  static async create(
    repoPath: string,
    branchName: string,
    baseBranch: string,
  ): Promise<SandboxContext> {
    const worktreeDir = join(repoPath, '..', '.oac-worktrees', branchName);
    await mkdir(worktreeDir, { recursive: true });

    // Create worktree
    await execGit(repoPath, [
      'worktree', 'add', worktreeDir, '-b', branchName, `origin/${baseBranch}`
    ]);

    return {
      path: worktreeDir,
      branchName,
      cleanup: async () => {
        await execGit(repoPath, ['worktree', 'remove', worktreeDir, '--force']);
      },
    };
  }
}
```

### Failure Recovery

```
Job fails
    |
    v
Was it a transient error? (network, timeout, OOM)
    |          |
   yes         no
    |          |
    v          v
Retry with   Was it a partial result?
backoff      (some files changed, some valid)
    |          |         |
    |         yes        no
    |          |         |
    |          v         v
    |     Salvage:    Log failure,
    |     validate    move to next
    |     changed     task
    |     files,
    |     create
    |     partial PR
    v
Re-enqueue with
attempts++
```

Transient error detection:

```typescript
function isTransient(error: OacError): boolean {
  return (
    error.code === 'AGENT_TIMEOUT' ||
    error.code === 'AGENT_OOM' ||
    error.code === 'NETWORK_ERROR' ||
    error.code === 'GIT_LOCK_FAILED'
  );
}
```

### Key Design Decisions

1. **Default concurrency of 2:** Most developer machines can handle 2 concurrent agent processes without degradation. Configurable up to `os.cpus().length`.
2. **Max 2 retry attempts:** One retry for transient failures. Beyond that, the task is likely genuinely difficult.
3. **No shared state between workers:** Each worker is fully isolated via worktree. No locks needed.
4. **Graceful shutdown:** `SIGINT` triggers `abort()`, which sends `SIGTERM` to all agent child processes, waits 5 seconds, then `SIGKILL`.

### Error Handling

| Error | Handling |
|-------|----------|
| Agent process crashes | Detect via exit code !== 0, classify as transient/permanent |
| Agent exceeds token budget | Monitor token stream, abort at 90% of task budget |
| Agent exceeds timeout | Kill process after configurable timeout (default: 300s) |
| Git worktree conflict | Unique branch names with timestamp suffix prevent this |
| Disk full during execution | Pre-check available space, abort if < 500MB |
| All agents fail | Return partial results, suggest manual intervention |

---

## 10. Feature 6: Contribution Tracking

### Architecture

```
ExecutionResult + Task + RunMetadata
                |
                v
        +-------+--------+
        | Log Entry Builder|
        | (structured JSON)|
        +-------+--------+
                |
                v
        +-------+--------+
        | .oac/ Writer    |
        | (atomic file    |
        |  writes)        |
        +-------+--------+
                |
                v
        .oac/contributions/YYYY-MM-DD-HHMMSS-user.json
                |
                v
        +-------+--------+
        | Leaderboard     |
        | Aggregator      |
        | (read-time      |
        |  computation)   |
        +-------+--------+
                |
                v
        .oac/leaderboard.json  (cached, rebuilt on demand)
```

### `.oac/` Directory Structure

```
.oac/
├── config.json                                  # OAC metadata for this repo
├── contributions/
│   ├── 2026-02-17-143052-jiun.json             # Individual contribution log
│   ├── 2026-02-17-151023-jiun.json
│   └── 2026-02-18-091500-alice.json
├── leaderboard.json                             # Aggregated leaderboard (cached)
└── .gitkeep
```

### Contribution Log Schema

```typescript
// packages/tracking/src/log-schema.ts

export interface ContributionLog {
  /** Schema version for forward compatibility */
  version: '1.0';

  /** Unique ID for this contribution run */
  runId: string;

  /** When this run started */
  timestamp: string; // ISO 8601

  /** Who initiated the run */
  contributor: {
    githubUsername: string;
    email?: string;
  };

  /** Target repository */
  repo: {
    fullName: string;
    headSha: string;
    defaultBranch: string;
  };

  /** Token budget for this run */
  budget: {
    provider: AgentProviderId;
    totalTokensBudgeted: number;
    totalTokensUsed: number;
    estimatedCostUsd?: number;
  };

  /** Tasks executed in this run */
  tasks: ContributionTask[];

  /** Overall run metrics */
  metrics: {
    tasksDiscovered: number;
    tasksAttempted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    totalDuration: number;    // seconds
    totalFilesChanged: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

export interface ContributionTask {
  taskId: string;
  title: string;
  source: TaskSource;
  complexity: TaskComplexity;
  status: 'success' | 'partial' | 'failed';

  /** Token usage for this specific task */
  tokensUsed: number;

  /** Time spent on this task */
  duration: number; // seconds

  /** Files modified */
  filesChanged: string[];

  /** PR created (if any) */
  pr?: {
    number: number;
    url: string;
    status: 'open' | 'merged' | 'closed';
  };

  /** Linked issue (if any) */
  linkedIssue?: {
    number: number;
    url: string;
  };

  /** Error details (if failed) */
  error?: string;
}
```

### Filename Convention

```
YYYY-MM-DD-HHmmss-{githubUsername}.json
```

Example: `2026-02-17-143052-jiun.json`

This ensures:
- Chronological sorting by filename
- No collisions (timestamp + user)
- Human-readable at a glance
- Git-friendly (one file per run, no merge conflicts)

### Leaderboard Data Model

```typescript
export interface Leaderboard {
  /** When this leaderboard was last computed */
  generatedAt: string;

  /** Entries sorted by total contributions descending */
  entries: LeaderboardEntry[];

  /** Repository-level statistics */
  repoStats: {
    totalContributions: number;
    totalTokensUsed: number;
    totalPRsCreated: number;
    totalPRsMerged: number;
    firstContribution: string;
    lastContribution: string;
  };
}

export interface LeaderboardEntry {
  githubUsername: string;
  totalRuns: number;
  totalTasksCompleted: number;
  totalTokensDonated: number;
  totalFilesChanged: number;
  totalLinesChanged: number;
  totalPRsCreated: number;
  totalPRsMerged: number;
  favoriteTaskSource: TaskSource;
  firstContribution: string;
  lastContribution: string;
}
```

The leaderboard is computed lazily by scanning all files in `.oac/contributions/` and aggregating. It is cached in `.oac/leaderboard.json` and rebuilt when a new contribution log is written or when explicitly requested.

### Key Design Decisions

1. **JSON over database:** All tracking is plain JSON files in git. No SQLite, no external database. This keeps the system git-native and enables anyone to read/audit contributions by simply browsing the `.oac/` directory.
2. **One file per run, not per task:** A single run may execute multiple tasks. Grouping by run provides better context.
3. **Schema versioning:** The `version` field allows future schema migrations without breaking old logs.
4. **Leaderboard is derived, not maintained:** No mutable leaderboard state. It is always recomputable from the contribution logs. The cached file is a performance optimization.

### Error Handling

| Error | Handling |
|-------|----------|
| Write permission denied on `.oac/` | Create directory if missing. If truly no permission, log to stderr and continue. |
| Concurrent writes (two OAC instances) | Timestamp + username in filename prevents collisions. |
| Corrupted log file | Validate against JSON schema on read. Skip corrupted files with warning. |
| `.oac/` not in `.gitignore` but should be | OAC should NOT add `.oac/` to `.gitignore`. The directory is meant to be committed. |

---

## 11. Feature 7: CLI + Dashboard

### CLI Command Design

```
oac <command> [options]

Commands:
  oac run              Execute a contribution run
  oac scan             Discover tasks without executing
  oac plan             Show execution plan (scan + budget estimation)
  oac status           Show status of running/recent jobs
  oac log              View contribution history
  oac leaderboard      Show contribution leaderboard
  oac config           Manage configuration
  oac init             Initialize OAC in a repository
  oac dashboard        Launch web dashboard

Global Options:
  --config <path>      Path to config file (default: oac.config.ts)
  --verbose            Enable verbose logging
  --json               Output as JSON (for scripting)
  --no-color           Disable colored output
```

#### Command Details

```
oac run [options]
  --repo <owner/repo>          Target repository (overrides config)
  --repos <owner/repo,...>     Multiple target repositories
  --tokens <number>            Token budget for this run
  --provider <id>              AI agent provider to use
  --concurrency <number>       Max parallel agents (default: 2)
  --dry-run                    Show what would be done without executing
  --task-filter <source,...>   Only run tasks from these sources
  --max-tasks <number>         Maximum tasks to execute
  --timeout <seconds>          Per-task timeout
  --mode <new-pr|direct>       Execution mode (default: new-pr)
  --skip-validation            Skip lint/test validation (use with caution)

oac scan [options]
  --repo <owner/repo>          Target repository
  --scanners <names,...>       Run only specific scanners
  --min-priority <number>      Only show tasks above this priority
  --format <table|json|md>     Output format (default: table)

oac plan [options]
  --repo <owner/repo>          Target repository
  --tokens <number>            Token budget to plan against
  --provider <id>              AI agent provider

oac status
  --watch                      Continuously update (like htop)
  --job <id>                   Show details for a specific job

oac log [options]
  --repo <owner/repo>          Filter by repository
  --user <username>            Filter by contributor
  --since <date>               Show logs since date
  --limit <number>             Maximum entries to show

oac init
  (Interactive setup: creates oac.config.ts, .oac/ directory)

oac dashboard
  --port <number>              Port for web dashboard (default: 3141)
  --open                       Open browser automatically
```

### Dashboard Architecture

```
+--------------------------------------------------+
|                 Browser (React SPA)               |
|  +--------------------------------------------+  |
|  | Toolbar: [Run] [Scan] [Stop] [Settings]    |  |
|  +--------------------------------------------+  |
|  | +------------------+ +---------------------+  |
|  | | Active Jobs      | | Task Queue          |  |
|  | | [Job 1: ████░ ] | | [Task 3: queued]    |  |
|  | | [Job 2: ██░░░ ] | | [Task 4: queued]    |  |
|  | +------------------+ +---------------------+  |
|  | +------------------------------------------+  |
|  | | Live Agent Output (terminal-style)       |  |
|  | | > Analyzing file src/utils.ts...         |  |
|  | | > Generating test cases...               |  |
|  | +------------------------------------------+  |
|  | +------------------+ +---------------------+  |
|  | | Contribution Log | | Leaderboard         |  |
|  | | [2/17: 3 tasks] | | #1 jiun: 42 tasks   |  |
|  | | [2/16: 5 tasks] | | #2 alice: 31 tasks   |  |
|  | +------------------+ +---------------------+  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
         |  SSE (Server-Sent Events)  ^
         v                            |
+--------------------------------------------------+
|              Dashboard Server                     |
|  (Express/Fastify, embedded in CLI process)       |
|                                                   |
|  GET  /api/status      -> current run status      |
|  GET  /api/jobs        -> job list                |
|  GET  /api/logs        -> contribution history    |
|  GET  /api/leaderboard -> leaderboard data        |
|  GET  /api/events      -> SSE stream              |
|  POST /api/run         -> start a new run         |
|  POST /api/abort       -> abort current run       |
+--------------------------------------------------+
         |
         v
+--------------------------------------------------+
|              OAC Core Engine                      |
|  (same process, shared event bus)                |
+--------------------------------------------------+
```

### Key Design Decisions

1. **Embedded server:** The dashboard runs as part of the CLI process, not a separate server. `oac dashboard` starts the web server and opens a browser. `oac run` also starts the SSE server (on a random port) so the dashboard can connect.

2. **SSE over WebSocket:** Server-Sent Events are simpler, unidirectional (server -> client), and sufficient for our use case. The dashboard only needs to receive updates. User commands go through REST POST endpoints.

3. **React + Vite:** The dashboard is a pre-built React SPA served as static files from the npm package. No build step required at runtime. Vite is used only during development of the dashboard itself.

4. **Terminal-style output:** The live agent output panel uses `xterm.js` to render terminal output faithfully, including ANSI colors.

5. **CLI-first:** Every dashboard feature is also available via CLI flags. The dashboard is a convenience layer, not a requirement.

### Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CLI framework | Commander.js | Mature, well-typed, supports subcommands |
| CLI output | Ink (React for CLI) | Rich terminal UI, progress bars, tables |
| Dashboard server | Fastify | Fast, low overhead, good TypeScript support |
| Dashboard client | React + Vite | Standard, fast HMR during dev |
| Real-time updates | SSE (EventSource) | Simpler than WebSocket for unidirectional streams |
| Terminal rendering | xterm.js | Faithful terminal output in browser |

---

## 12. Configuration System

### Config File Format

OAC supports two config formats:
1. `oac.config.ts` (recommended) - TypeScript config with full type checking and IDE support
2. `.oacrc.json` - JSON config for simpler setups

Config resolution order (later overrides earlier):
1. Built-in defaults
2. `~/.oac/config.json` (global user config)
3. `oac.config.ts` or `.oacrc.json` (project config)
4. CLI flags
5. Environment variables (`OAC_*`)

### TypeScript Config Schema

```typescript
// packages/core/src/config.ts

import { defineConfig } from '@oac/core';

export default defineConfig({
  /**
   * Target repositories.
   * Can be overridden with --repo flag.
   */
  repos: [
    'owner/repo',
    { name: 'owner/repo2', branch: 'develop' },
  ],

  /**
   * AI agent provider configuration.
   */
  provider: {
    /** Which provider to use */
    id: 'claude-code', // 'claude-code' | 'codex-cli' | 'opencode'

    /** Provider-specific configuration */
    options: {
      model: 'opus',                    // provider-specific model selection
      maxTokensPerTask: 50_000,         // hard cap per task
      systemPrompt: undefined,          // custom system prompt override
    },
  },

  /**
   * Token budget configuration.
   */
  budget: {
    /** Total tokens available for this run */
    totalTokens: 100_000,

    /** Percentage reserved for retries (0.0-1.0) */
    reservePercent: 0.10,

    /** Overestimation factor for safety (1.0 = no padding) */
    estimationPadding: 1.20,
  },

  /**
   * Task discovery configuration.
   */
  discovery: {
    /** Which scanners to enable */
    scanners: {
      lint: true,
      todo: true,
      testGap: true,
      deadCode: false,         // disabled by default (slow, needs full history)
      githubIssues: true,
    },

    /** GitHub issue label filters */
    issueLabels: ['good-first-issue', 'help-wanted', 'bug'],

    /** Minimum priority score to consider (0-100) */
    minPriority: 20,

    /** Maximum tasks to discover (for performance) */
    maxTasks: 50,

    /** Custom task sources (plugins) */
    customScanners: [],

    /** Files/directories to exclude from scanning */
    exclude: [
      'node_modules',
      'dist',
      'build',
      '.git',
      '*.min.js',
      'vendor/',
    ],
  },

  /**
   * Execution configuration.
   */
  execution: {
    /** Maximum concurrent agent executions */
    concurrency: 2,

    /** Per-task timeout in seconds */
    taskTimeout: 300,

    /** Maximum retry attempts for failed tasks */
    maxRetries: 2,

    /** Default execution mode */
    mode: 'new-pr',

    /** Branch naming pattern. Variables: {task}, {date}, {user} */
    branchPattern: 'oac/{date}/{task}',

    /** Validation steps to run before creating PR */
    validation: {
      lint: true,        // run linter on changed files
      test: true,        // run tests
      typeCheck: true,   // run type checker (TypeScript)
      maxDiffLines: 500, // reject diffs larger than this
    },

    /** PR configuration */
    pr: {
      draft: false,
      labels: ['oac-contribution'],
      reviewers: [],      // auto-assign reviewers
      assignees: [],
    },
  },

  /**
   * Completion and integration configuration.
   */
  completion: {
    /** Project management integrations */
    integrations: {
      linear: {
        enabled: false,
        apiKey: '${LINEAR_API_KEY}', // environment variable reference
        teamId: 'TEAM_ID',
      },
      jira: {
        enabled: false,
        baseUrl: 'https://your-org.atlassian.net',
        email: '${JIRA_EMAIL}',
        apiToken: '${JIRA_API_TOKEN}',
        projectKey: 'PROJ',
      },
    },

    /** PR monitoring */
    monitor: {
      enabled: false,
      pollInterval: 300,          // seconds
      autoRespondToReviews: false,
      autoDeleteBranch: true,
    },
  },

  /**
   * Contribution tracking configuration.
   */
  tracking: {
    /** Path to .oac directory (relative to repo root) */
    directory: '.oac',

    /** Whether to auto-commit tracking data */
    autoCommit: false,

    /** Include in git (do not add to .gitignore) */
    gitTracked: true,
  },

  /**
   * Dashboard configuration.
   */
  dashboard: {
    port: 3141,
    openBrowser: true,
  },
});
```

### `defineConfig` Helper

```typescript
export function defineConfig(config: OacConfig): OacConfig {
  return config;
}
```

This is a passthrough function that exists solely for TypeScript autocompletion and validation in the config file.

### Environment Variable Interpolation

Config values containing `${VAR_NAME}` are resolved from environment variables at load time. This keeps secrets out of config files.

```typescript
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => {
    const envValue = process.env[varName];
    if (!envValue) {
      throw new OacConfigError(
        `Environment variable ${varName} is referenced in config but not set`
      );
    }
    return envValue;
  });
}
```

---

## 13. Security Architecture

### Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| API token exposure in logs | High | Critical | Never log tokens. Redact from agent output. |
| Agent writes malicious code | Medium | High | Validation step (lint, test, diff review). Human PR review. |
| Agent accesses unintended files | Medium | Medium | Worktree isolation. No access outside repo. |
| Supply chain: malicious repo tricks agent | Low | High | Diff size limits. No `eval()`. Sandbox validation. |
| GitHub token with excessive scopes | Medium | High | Document minimum required scopes. Warn on excess. |
| Secrets committed to .oac/ | Low | Critical | Never write tokens/keys to tracking logs. |
| Concurrent runs corrupt git state | Low | Medium | Worktree isolation. File locking for .oac/ writes. |

### Token & Secret Handling

```typescript
// packages/core/src/secrets.ts

/**
 * Secret resolution hierarchy:
 * 1. Environment variables (OAC_GITHUB_TOKEN, etc.)
 * 2. System keychain (via keytar)
 * 3. Git credential helper (for GitHub tokens)
 * 4. Config file (discouraged, warns if detected)
 */
export class SecretResolver {
  async resolveGitHubToken(): Promise<string> {
    // 1. Environment variable
    if (process.env.OAC_GITHUB_TOKEN || process.env.GITHUB_TOKEN) {
      return process.env.OAC_GITHUB_TOKEN || process.env.GITHUB_TOKEN!;
    }

    // 2. GitHub CLI auth (gh auth token)
    try {
      const { stdout } = await exec('gh auth token');
      if (stdout.trim()) return stdout.trim();
    } catch { /* gh not available */ }

    // 3. Git credential helper
    try {
      return await this.getFromGitCredential('github.com');
    } catch { /* no credential stored */ }

    throw new OacSecretError(
      'No GitHub token found. Set OAC_GITHUB_TOKEN, run `gh auth login`, ' +
      'or configure a git credential helper.'
    );
  }
}
```

### Minimum GitHub Token Scopes

```
Required:
  - repo              (read/write access to repositories)

Optional (for enhanced features):
  - read:org          (read org membership for private repos)
  - workflow          (trigger CI on PRs if needed)
```

### Agent Output Sanitization

All agent output is passed through a sanitizer before logging or displaying:

```typescript
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{36}/g,           // GitHub personal access tokens
  /gho_[A-Za-z0-9_]{36}/g,           // GitHub OAuth tokens
  /github_pat_[A-Za-z0-9_]{82}/g,    // GitHub fine-grained PATs
  /sk-[A-Za-z0-9]{48}/g,             // OpenAI API keys
  /sk-ant-[A-Za-z0-9-_]{93}/g,       // Anthropic API keys
  /lin_api_[A-Za-z0-9]{40}/g,        // Linear API keys
  /xoxb-[A-Za-z0-9-]+/g,            // Slack bot tokens
];

export function sanitize(output: string): string {
  let sanitized = output;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}
```

### Diff Validation (Anti-Malicious-Code)

Before any PR is created, the diff is validated:

```typescript
export interface DiffValidation {
  /** Maximum total lines changed */
  maxDiffLines: number;          // default: 500

  /** Reject diffs that add new dependencies */
  rejectNewDependencies: boolean; // default: false (warn only)

  /** Reject diffs that modify security-sensitive files */
  rejectSecurityFiles: boolean;  // default: true

  /** Files that should never be modified by OAC */
  protectedFiles: string[];      // default: ['.env*', '*.pem', '*.key', 'package-lock.json']

  /** Patterns that should never appear in added lines */
  forbiddenPatterns: RegExp[];   // default: [/eval\(/, /Function\(/, /child_process/]
}
```

---

## 14. Error Handling Strategy

### Error Taxonomy

```typescript
// packages/core/src/errors.ts

export class OacError extends Error {
  constructor(
    message: string,
    public readonly code: OacErrorCode,
    public readonly severity: 'fatal' | 'recoverable' | 'warning',
    public readonly context?: Record<string, unknown>,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'OacError';
  }
}

export type OacErrorCode =
  // Repo errors
  | 'REPO_NOT_FOUND'
  | 'REPO_ARCHIVED'
  | 'REPO_NO_PERMISSION'
  | 'REPO_CLONE_FAILED'
  // Discovery errors
  | 'SCANNER_FAILED'
  | 'SCANNER_TIMEOUT'
  | 'NO_TASKS_FOUND'
  // Budget errors
  | 'BUDGET_INSUFFICIENT'
  | 'TOKENIZER_UNAVAILABLE'
  // Execution errors
  | 'AGENT_NOT_AVAILABLE'
  | 'AGENT_EXECUTION_FAILED'
  | 'AGENT_TIMEOUT'
  | 'AGENT_OOM'
  | 'AGENT_TOKEN_LIMIT'
  // Validation errors
  | 'VALIDATION_LINT_FAILED'
  | 'VALIDATION_TEST_FAILED'
  | 'VALIDATION_DIFF_TOO_LARGE'
  | 'VALIDATION_FORBIDDEN_PATTERN'
  // Completion errors
  | 'PR_CREATION_FAILED'
  | 'PR_PUSH_REJECTED'
  | 'WEBHOOK_DELIVERY_FAILED'
  // Config errors
  | 'CONFIG_INVALID'
  | 'CONFIG_SECRET_MISSING'
  // System errors
  | 'NETWORK_ERROR'
  | 'DISK_SPACE_LOW'
  | 'GIT_LOCK_FAILED';
```

### Global Error Handler

```typescript
export function handleError(error: OacError, eventBus: OacEventBus): void {
  switch (error.severity) {
    case 'fatal':
      eventBus.emit('error:fatal', { error });
      // Log to stderr, write to crash report, exit with code 1
      writeCrashReport(error);
      process.exit(1);

    case 'recoverable':
      eventBus.emit('error:recoverable', { error });
      // Log warning, continue execution
      logger.warn(`Recoverable error: ${error.message}`, { code: error.code });
      break;

    case 'warning':
      eventBus.emit('error:warning', { error });
      logger.info(`Warning: ${error.message}`);
      break;
  }
}
```

### Crash Reports

Fatal errors produce a crash report at `~/.oac/crash-reports/YYYY-MM-DD-HHmmss.json`:

```typescript
export interface CrashReport {
  timestamp: string;
  version: string;
  error: {
    code: OacErrorCode;
    message: string;
    stack: string;
  };
  system: {
    platform: string;
    nodeVersion: string;
    memory: { total: number; free: number };
    diskSpace: { total: number; free: number };
  };
  context: {
    command: string;
    args: string[];
    config: Partial<OacConfig>; // sanitized, no secrets
    runState: {
      jobsCompleted: number;
      jobsRunning: number;
      jobsQueued: number;
      tokensUsed: number;
    };
  };
}
```

---

## 15. Technology Stack

### Runtime & Language

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| Runtime | Node.js | >= 22 | LTS, native ESM, built-in test runner as fallback |
| Language | TypeScript | >= 5.5 | Type safety, IDE support, config file support |
| Module format | ESM | - | Modern standard, tree-shakeable |

### Core Dependencies

| Package | Purpose | Why This One |
|---------|---------|-------------|
| `commander` | CLI framework | Battle-tested, typed, subcommand support |
| `@octokit/rest` | GitHub API | Official SDK, typed, handles rate limiting |
| `simple-git` | Git operations | Promise-based, comprehensive git API |
| `eventemitter3` | Event bus | Fast, typed, works in all environments |
| `p-queue` | Job queue | Priority queue with concurrency control |
| `tiktoken` | Token counting | Official OpenAI tokenizer (works for Claude too) |
| `zod` | Schema validation | Runtime validation for configs and API responses |
| `chalk` | Terminal colors | Standard for CLI output |
| `ora` | Spinners | Clean loading indicators |
| `cli-table3` | Tables | Terminal table rendering |
| `fastify` | Dashboard server | Fast, low overhead, TypeScript-first |
| `better-sqlite3` | Metadata cache | Fast, zero-config, single-file database |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `vitest` | Testing |
| `turbo` | Monorepo build orchestration |
| `tsup` | TypeScript bundling |
| `@biomejs/biome` | Lint + format |
| `changesets` | Version management |

### Peer / Optional Dependencies

| Package | Purpose | When Needed |
|---------|---------|-------------|
| `@anthropic-ai/tokenizer` | Precise Claude token counting | When using Claude Code provider |
| `keytar` | System keychain access | When storing secrets in keychain |
| `tree-sitter` | AST parsing for dead code detection | When dead code scanner enabled |

---

## 16. Integration Map

This diagram shows how all seven features interconnect:

```
                                    User
                                     |
                              +------v-------+
                              |   CLI (F7)   |
                              |  Dashboard   |
                              +------+-------+
                                     |
                         +-----------v-----------+
                         |    Orchestrator        |
                         |    (Core Engine)       |
                         |    Event Bus           |
                         +--+--+--+--+--+--+-----+
                            |  |  |  |  |  |
              +-------------+  |  |  |  |  +-------------+
              |                |  |  |  |                 |
     +--------v-----+  +------v--v--v------+  +---------v-------+
     | Repo Select  |  | Task Discovery    |  | Contribution    |
     | (F1)         |  | (F2)              |  | Tracking (F6)   |
     |              |  |                   |  |                 |
     | ResolvedRepo +->| Task[]            |  | .oac/ logs      |
     +--------------+  +--------+----------+  +--------^--------+
                                |                      |
                       +--------v----------+           |
                       | Token Budget      |           |
                       | Estimator (F3)    |           |
                       |                   |           |
                       | ExecutionPlan     |           |
                       +--------+----------+           |
                                |                      |
                       +--------v----------+           |
                       | Parallel          |           |
                       | Execution (F5)    |           |
                       |                   |           |
                       | ExecutionResult[] +-----------+
                       +--------+----------+
                                |
                       +--------v----------+
                       | Completion        |
                       | Handler (F4)      |
                       |                   |
                       | PRs, Issues,      |
                       | Webhooks          |
                       +-------------------+
```

### Data Flow Between Features

| From | To | Data | Mechanism |
|------|----|------|-----------|
| F1 (Repo) | F2 (Discovery) | `ResolvedRepo` | Direct function call |
| F1 (Repo) | F5 (Execution) | `ResolvedRepo.localPath` | Passed through orchestrator |
| F2 (Discovery) | F3 (Budget) | `Task[]` | Direct function call |
| F3 (Budget) | F5 (Execution) | `ExecutionPlan` | Direct function call |
| F5 (Execution) | F4 (Completion) | `ExecutionResult` | Event bus + direct call |
| F5 (Execution) | F6 (Tracking) | `ExecutionResult` | Event bus listener |
| F4 (Completion) | F6 (Tracking) | `PR metadata` | Event bus listener |
| All | F7 (CLI/Dashboard) | Events | Event bus -> SSE |

### External Integration Points

| System | Integration Method | Authentication |
|--------|--------------------|---------------|
| GitHub | `@octokit/rest` SDK | PAT or `gh auth` |
| Linear | Linear SDK / REST API | API key |
| Jira | Jira REST API v3 | Email + API token |
| Slack | Webhook URL | Webhook secret |
| AI Agents | Child process (CLI) | Each agent's own auth |

---

## 17. Future Considerations

### Phase 2 Features (Not in MVP)

1. **Plugin System:** Allow community-contributed scanners, agent adapters, and completion handlers.
   ```typescript
   // Future plugin interface
   export interface OacPlugin {
     name: string;
     scanners?: Scanner[];
     agents?: AgentProvider[];
     completionHandlers?: ProjectManagementProvider[];
     hooks?: {
       beforeExecution?: (task: Task) => Promise<Task>;
       afterExecution?: (result: ExecutionResult) => Promise<void>;
     };
   }
   ```

2. **Remote Execution Mode:** Run agent tasks on a remote server (for CI/CD integration). The local machine sends the execution plan; a hosted worker processes it.

3. **Team Mode:** Shared `.oac/` tracking across a team with conflict resolution. Centralized leaderboard.

4. **Auto-Review Response:** When a PR review comment is received, automatically spawn an agent to address it.

5. **Cross-Repo Intelligence:** Learn from contribution patterns across multiple repos to improve task priority and estimation accuracy.

6. **Token Marketplace:** Allow developers to pool or trade unused tokens through a shared queue.

### Scaling Considerations

- **Large repos (>1GB):** Sparse checkout support. Only clone directories relevant to discovered tasks.
- **Many repos (>10):** Parallel repo processing with per-repo rate limiting.
- **Long-running executions:** Checkpoint and resume support for complex tasks.
- **High-frequency runs:** Incremental scanning (only scan files changed since last run).

### Migration Path

The architecture is designed for progressive enhancement:

1. **v0.1:** CLI-only, single repo, single agent, basic lint+TODO scanning
2. **v0.2:** Multi-scanner, token estimation, contribution tracking
3. **v0.3:** Parallel execution, multiple agents, PR lifecycle
4. **v0.4:** Dashboard, webhooks, external integrations
5. **v1.0:** Full feature set, plugin system, documentation

---

## Appendix A: Sequence Diagram - Complete Run

```
User          CLI        Orchestrator  RepoSvc    Discovery   Budget    Execution  Completion  Tracking
 |             |              |           |           |          |          |           |          |
 |--oac run--->|              |           |           |          |          |           |          |
 |             |--start------>|           |           |          |          |           |          |
 |             |              |--resolve->|           |          |          |           |          |
 |             |              |           |--clone--->|          |          |           |          |
 |             |              |           |<--repo----|          |          |           |          |
 |             |              |<--repo----|           |          |          |           |          |
 |             |              |--scan-----|---------->|          |          |           |          |
 |             |              |           |           |--lint--->|          |           |          |
 |             |              |           |           |--todo--->|          |           |          |
 |             |              |           |           |--tests-->|          |           |          |
 |             |              |           |           |--issues->|          |           |          |
 |             |              |<--tasks---|-----------|          |          |           |          |
 |             |              |--estimate-|-----------|--------->|          |           |          |
 |             |              |<--plan----|-----------|----------|          |           |          |
 |             |              |--execute--|-----------|----------|--------->|           |          |
 |             |              |           |           |          |          |--worker1->|          |
 |             |              |           |           |          |          |--worker2->|          |
 |             |<--progress---|-----------|-----------|----------|----------|           |          |
 |<--display---|              |           |           |          |          |           |          |
 |             |              |           |           |          |          |<-result1--|          |
 |             |              |           |           |          |          |--create PR---------->|
 |             |              |           |           |          |          |           |--log---->|
 |             |              |           |           |          |          |<-result2--|          |
 |             |              |           |           |          |          |--create PR---------->|
 |             |              |           |           |          |          |           |--log---->|
 |             |              |<--done----|-----------|----------|----------|           |          |
 |             |<--summary----|           |           |          |          |           |          |
 |<--results---|              |           |           |          |          |           |          |
```

## Appendix B: Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OAC_GITHUB_TOKEN` | GitHub personal access token | Yes (or `gh auth`) |
| `GITHUB_TOKEN` | Fallback for GitHub token | No |
| `OAC_PROVIDER` | Default AI agent provider | No |
| `OAC_CONCURRENCY` | Default concurrency level | No |
| `OAC_LOG_LEVEL` | Log verbosity (debug/info/warn/error) | No |
| `LINEAR_API_KEY` | Linear API key | No (if Linear enabled) |
| `JIRA_EMAIL` | Jira account email | No (if Jira enabled) |
| `JIRA_API_TOKEN` | Jira API token | No (if Jira enabled) |
| `OAC_CACHE_DIR` | Cache directory override | No (default: `~/.oac/cache`) |
| `OAC_NO_TELEMETRY` | Disable anonymous usage stats | No |

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI-powered CLI tool (Claude Code, Codex CLI, OpenCode) that can read, reason about, and modify code |
| **Provider** | An adapter that wraps a specific agent CLI into the OAC `AgentProvider` interface |
| **Task** | A discrete, actionable unit of work discovered by a scanner (e.g., "fix lint error in utils.ts") |
| **Scanner** | A module that analyzes a codebase or external source to discover tasks |
| **Run** | A single invocation of `oac run`, which may execute multiple tasks |
| **Job** | A task assigned to a worker for execution. Has lifecycle: queued -> running -> completed/failed |
| **Worker** | A single agent process executing a job in an isolated git worktree |
| **Execution Plan** | The ordered list of tasks selected for execution within the token budget |
| **Worktree** | A git worktree providing an isolated working directory that shares the same `.git` store |
| **Contribution Log** | A JSON file recording the results of a run, stored in `.oac/contributions/` |

---

*This document was authored by Claude as the System Architecture perspective for the OAC multi-agent planning session. It is intended to serve as the foundational architecture reference for implementation.*
