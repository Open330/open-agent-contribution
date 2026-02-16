# Open Agent Contribution (OAC) - Technical Spec & Implementation Guide

**Author:** Codex (Implementation Perspective)
**Date:** 2026-02-17
**Status:** Draft v1.0

---

## 1. Purpose

This document provides implementation-ready specifications not fully covered by the Architecture doc (Claude) or the UX/DX doc (Gemini). It focuses on: CLI command tree with exact output, REST API contracts, package.json dependencies with pinned versions, testing strategy, and CI/CD pipeline.

---

## 2. CLI Command Tree (Complete Reference)

### 2.1 Global

```
oac [command] [options]

Global Options:
  -V, --version           Print version
  -h, --help              Show help
  --config <path>         Config file path  [default: "oac.config.ts"]
  --verbose               Debug-level logging
  --json                  Machine-readable JSON output
  --no-color              Disable ANSI colors (also respects NO_COLOR env)
```

### 2.2 `oac init`

```bash
$ oac init
  ___   _   ___
 / _ \ /_\ / __|
| (_) / _ \ (__
 \___/_/ \_\___|  v0.1.0

Welcome to Open Agent Contribution.

? Select AI provider(s): (space to toggle)
  [x] Claude Code
  [ ] Codex CLI
  [ ] OpenCode

? GitHub token source: (auto-detected)
  > gh auth token (found)

? Monthly token budget: 100000
? Add your first repo (owner/repo): open330/open-agent-contribution

Created: oac.config.ts
Created: .oac/

Run `oac doctor` to verify or `oac scan` to discover tasks.
```

### 2.3 `oac doctor`

Validates environment readiness.

```bash
$ oac doctor
Checking environment...

  Node.js      >= 22.0.0         v22.11.0   PASS
  pnpm         >= 9.0.0          v9.15.4    PASS
  git          >= 2.30           v2.47.1    PASS
  gh CLI       any               v2.65.0    PASS
  GitHub auth  token present     ghp_****   PASS
  Claude Code  installed         v1.0.26    PASS
  Codex CLI    installed         --         SKIP (not configured)
  Disk space   >= 2 GB free      48 GB      PASS

All checks passed.
```

### 2.4 `oac scan`

```bash
$ oac scan --repo open330/example-repo

Cloning open330/example-repo (shallow)... done (2.1s)
Running scanners: lint, todo, test-gap, github-issues

 # | Source       | Title                              | Complexity | Priority | Est. Tokens
---|-------------|-------------------------------------|------------|----------|------------
 1 | lint        | Fix 12 ESLint errors in src/api/    | trivial    |       87 |       3,200
 2 | test-gap    | Add tests for src/utils/parser.ts   | simple     |       82 |      12,400
 3 | github-issue| #42: Fix date parsing in timezone   | moderate   |       76 |      18,500
 4 | todo        | TODO cluster in src/db/migrate.ts   | simple     |       65 |       8,100
 5 | dead-code   | Remove unused export in helpers.ts  | trivial    |       58 |       2,100

Found 5 tasks. Use `oac plan --tokens <n>` to build an execution plan.
```

Flags:

```
--repo <owner/repo>           Target repo (required if not in config)
--scanners <lint,todo,...>    Comma-separated scanner filter
--min-priority <0-100>       Minimum priority threshold  [default: 20]
--format <table|json|md>     Output format               [default: table]
```

### 2.5 `oac plan`

```bash
$ oac plan --repo open330/example-repo --tokens 30000

Execution Plan (budget: 30,000 tokens, reserve: 3,000)

 # | Task                                | Est. Tokens | Cumulative | Confidence
---|-------------------------------------|-------------|------------|----------
 1 | Fix 12 ESLint errors in src/api/    |       3,200 |      3,200 |      0.92
 2 | Add tests for src/utils/parser.ts   |      12,400 |     15,600 |      0.78
 3 | TODO cluster in src/db/migrate.ts   |       8,100 |     23,700 |      0.81

Budget used: 23,700 / 27,000 (effective)
Reserve:      3,000 (10%)
Remaining:    3,300

Deferred (2 tasks):
  - #42: Fix date parsing (18,500 tokens - exceeds remaining budget)
  - Remove unused export (low priority, skipped)

Run `oac run --tokens 30000` to execute this plan.
```

### 2.6 `oac run`

```bash
$ oac run --repo open330/example-repo --tokens 30000 --concurrency 2

Starting OAC run (budget: 30,000 tokens, concurrency: 2)

[1/3] Fix 12 ESLint errors in src/api/
  Agent: claude-code | Branch: oac/20260217/fix-eslint-errors
  [==========] 100%  2,980 tokens  12.4s
  Validation: lint PASS | tests PASS | diff 34 lines
  PR #147 created: https://github.com/open330/example-repo/pull/147

[2/3] Add tests for src/utils/parser.ts
  Agent: claude-code | Branch: oac/20260217/add-parser-tests
  [========= ] 90%  11,200 tokens  48.2s
  Validation: lint PASS | tests PASS | diff 189 lines
  PR #148 created: https://github.com/open330/example-repo/pull/148

[3/3] TODO cluster in src/db/migrate.ts
  Agent: claude-code | Branch: oac/20260217/resolve-migrate-todos
  [=======   ] 70%  FAILED (agent timeout after 300s)
  Retrying (attempt 2/2)...
  [==========] 100%  7,800 tokens  102.1s
  Validation: lint PASS | tests PASS | diff 67 lines
  PR #149 created: https://github.com/open330/example-repo/pull/149

Run Summary
  Tasks:    3 attempted, 3 succeeded, 0 failed
  Tokens:   21,980 / 30,000 used (73%)
  PRs:      3 created
  Duration: 2m 43s
  Log:      .oac/contributions/2026-02-17-143052-jiun.json
```

Additional flags:

```
--dry-run                    Show plan without executing
--provider <id>              Agent provider      [default: from config]
--task-filter <sources>      Only these scanner sources
--max-tasks <n>              Cap number of tasks
--timeout <seconds>          Per-task timeout     [default: 300]
--mode <new-pr|direct>       PR creation mode     [default: new-pr]
--skip-validation            Skip lint/test gate
```

### 2.7 `oac status`

```bash
$ oac status
Active Run: abc123 (started 1m ago)

 Job ID   | Task                          | Status   | Tokens  | Duration
----------|-------------------------------|----------|---------|--------
 j-001    | Fix ESLint errors             | DONE     |   2,980 |    12s
 j-002    | Add parser tests              | RUNNING  |   8,400 |    34s
 j-003    | Resolve TODOs                 | QUEUED   |       - |      -

$ oac status --watch   # live-updating (refreshes every 2s)
```

### 2.8 `oac log`

```bash
$ oac log --limit 3

 Date       | Repo                  | Tasks | Tokens  | PRs | Status
------------|----------------------|-------|---------|-----|-------
 2026-02-17 | open330/example-repo | 3/3   |  21,980 |   3 | SUCCESS
 2026-02-16 | open330/other-repo   | 2/4   |  45,200 |   2 | PARTIAL
 2026-02-15 | open330/example-repo | 5/5   |  38,100 |   5 | SUCCESS

$ oac log --repo open330/example-repo --since 2026-02-01 --json
```

### 2.9 `oac leaderboard`

```bash
$ oac leaderboard

 #  | Contributor | Runs | Tasks | Tokens Used | PRs Merged
----|-------------|------|-------|-------------|----------
 1  | jiun        |   12 |    34 |     412,000 |        28
 2  | alice       |    8 |    21 |     287,500 |        19
 3  | bob         |    3 |     9 |      98,200 |         7
```

### 2.10 `oac config`

```bash
$ oac config get provider.id
claude-code

$ oac config set execution.concurrency 4
Updated execution.concurrency = 4

$ oac config list --format json
```

### 2.11 `oac dashboard`

```bash
$ oac dashboard --port 3141 --open
Dashboard running at http://localhost:3141
Opening browser...
```

---

## 3. REST API Endpoints (Dashboard Server)

The dashboard server is embedded in the CLI process via Fastify. All routes are under `/api/v1`.

### 3.1 Endpoints

| Method | Path                  | Description                 | Response              |
|--------|-----------------------|-----------------------------|-----------------------|
| GET    | `/api/v1/health`      | Server health check         | `{ status: "ok" }`   |
| GET    | `/api/v1/status`      | Current run status          | `RunStatus`           |
| GET    | `/api/v1/jobs`        | List jobs (active + recent) | `Job[]`               |
| GET    | `/api/v1/jobs/:id`    | Single job detail           | `Job`                 |
| GET    | `/api/v1/tasks`       | Discovered tasks            | `Task[]`              |
| GET    | `/api/v1/plan`        | Current execution plan      | `ExecutionPlan`       |
| GET    | `/api/v1/logs`        | Contribution history        | `ContributionLog[]`   |
| GET    | `/api/v1/leaderboard` | Leaderboard data            | `Leaderboard`         |
| GET    | `/api/v1/config`      | Current config (sanitized)  | `Partial<OacConfig>`  |
| GET    | `/api/v1/events`      | SSE event stream            | `text/event-stream`   |
| POST   | `/api/v1/run`         | Start a new run             | `{ runId: string }`   |
| POST   | `/api/v1/abort`       | Abort current run           | `{ aborted: true }`   |
| POST   | `/api/v1/scan`        | Trigger scan only           | `{ tasks: Task[] }`   |

### 3.2 SSE Event Stream (`/api/v1/events`)

```
event: repo:resolved
data: {"repo":{"fullName":"open330/example-repo","localPath":"/tmp/..."}}

event: task:discovered
data: {"tasks":[{"id":"abc","title":"Fix ESLint","priority":87}]}

event: execution:started
data: {"jobId":"j-001","task":{"id":"abc"},"agent":"claude-code"}

event: execution:progress
data: {"jobId":"j-001","tokensUsed":1200,"stage":"coding"}

event: execution:completed
data: {"jobId":"j-001","result":{"success":true,"totalTokensUsed":2980}}

event: pr:created
data: {"jobId":"j-001","prUrl":"https://github.com/.../pull/147"}

event: run:completed
data: {"summary":{"tasksSucceeded":3,"totalTokensUsed":21980}}
```

### 3.3 POST `/api/v1/run` Request Body

```typescript
interface RunRequest {
  repo?: string;           // "owner/repo" override
  tokens?: number;         // budget override
  provider?: string;       // agent provider override
  concurrency?: number;    // concurrency override
  dryRun?: boolean;        // plan-only mode
  taskFilter?: string[];   // scanner source filter
  maxTasks?: number;       // task count cap
}
```

### 3.4 Error Responses

All error responses follow:

```typescript
interface ApiError {
  error: {
    code: string;       // OacErrorCode
    message: string;
    details?: unknown;
  };
}
```

HTTP status codes: `400` (bad request), `404` (not found), `409` (run already active), `500` (internal).

---

## 4. Package Dependencies (Pinned Versions)

### 4.1 Root `package.json`

```jsonc
{
  "name": "open-agent-contribution",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "test:coverage": "turbo run test -- --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev --parallel",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@changesets/cli": "^2.27.12",
    "turbo": "^2.4.4",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

### 4.2 `packages/core/package.json`

```jsonc
{
  "name": "@oac/core",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "eventemitter3": "^5.0.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "tsup": "^8.3.6"
  }
}
```

### 4.3 `packages/cli/package.json`

```jsonc
{
  "name": "@oac/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "oac": "./dist/bin/oac.js" },
  "scripts": {
    "build": "tsup src/index.ts src/bin/oac.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@oac/core": "workspace:*",
    "@oac/repo": "workspace:*",
    "@oac/discovery": "workspace:*",
    "@oac/budget": "workspace:*",
    "@oac/execution": "workspace:*",
    "@oac/completion": "workspace:*",
    "@oac/tracking": "workspace:*",
    "commander": "^13.1.0",
    "chalk": "^5.4.1",
    "ora": "^8.1.1",
    "cli-table3": "^0.6.5"
  }
}
```

### 4.4 `packages/repo/package.json`

```jsonc
{
  "name": "@oac/repo",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@oac/core": "workspace:*",
    "@octokit/rest": "^21.1.1",
    "simple-git": "^3.27.0",
    "better-sqlite3": "^11.8.1"
  }
}
```

### 4.5 `packages/execution/package.json`

```jsonc
{
  "name": "@oac/execution",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@oac/core": "workspace:*",
    "p-queue": "^8.1.0",
    "execa": "^9.5.2"
  }
}
```

### 4.6 `packages/budget/package.json`

```jsonc
{
  "name": "@oac/budget",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@oac/core": "workspace:*",
    "tiktoken": "^1.0.18"
  },
  "optionalDependencies": {
    "@anthropic-ai/tokenizer": "^0.0.6"
  }
}
```

### 4.7 `packages/dashboard/package.json`

```jsonc
{
  "name": "@oac/dashboard",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@oac/core": "workspace:*",
    "fastify": "^5.2.1",
    "@fastify/static": "^8.1.0",
    "@fastify/cors": "^10.0.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^2.15.1",
    "@xterm/xterm": "^5.5.0"
  },
  "devDependencies": {
    "vite": "^6.1.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.6"
  }
}
```

### 4.8 Workspace Config (`pnpm-workspace.yaml`)

```yaml
packages:
  - "packages/*"
```

---

## 5. TypeScript Configuration

### 5.1 `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Each package extends with:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": { "outDir": "dist", "rootDir": "src" }
}
```

---

## 6. Turborepo Pipeline (`turbo.json`)

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "inputs": ["src/**", "tests/**", "vitest.config.*"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

## 7. Testing Strategy

### 7.1 Framework: Vitest

Root `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 10_000,
  },
});
```

### 7.2 Test Tiers

| Tier | Location | What it tests | Mocking strategy |
|------|----------|---------------|------------------|
| Unit | `packages/*/src/**/*.test.ts` | Pure functions, data transforms, algorithms | Full mocking of I/O, git, API |
| Integration | `packages/*/tests/integration/*.test.ts` | Cross-module flows (scan -> budget) | Mock external APIs, use real git repos (fixtures) |
| E2E | `tests/e2e/*.test.ts` | Full `oac run` with a fixture repo | Mock only AI agent responses (canned output) |

### 7.3 Test Fixtures

```
tests/
├── fixtures/
│   ├── repos/
│   │   ├── simple-ts/           # Minimal TS repo with lint errors + TODOs
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   └── index.ts     # Has TODO, lint issues, untested code
│   │   │   └── tsconfig.json
│   │   └── python-repo/         # Python repo for multi-language testing
│   ├── agent-responses/
│   │   ├── claude-fix-lint.json  # Canned agent output for lint fix
│   │   └── claude-add-tests.json # Canned agent output for test writing
│   └── github-api/
│       ├── issues-response.json  # Mock GET /repos/.../issues
│       └── repo-metadata.json    # Mock GET /repos/...
└── e2e/
    └── full-run.test.ts
```

### 7.4 Key Unit Test Targets (v0.1 priority)

| Package | File | Test cases |
|---------|------|------------|
| `core` | `config.ts` | Config merge order, env var interpolation, zod validation |
| `core` | `event-bus.ts` | Event emission, listener registration, typed events |
| `discovery` | `ranker.ts` | Priority scoring with various weight combos |
| `discovery` | `scanners/todo-scanner.ts` | Pattern matching, clustering, edge cases |
| `budget` | `estimator.ts` | Token math, knapsack selection, reserve calculation |
| `budget` | `providers/claude-counter.ts` | Token counting accuracy vs known strings |
| `execution` | `engine.ts` | Queue ordering, concurrency limits, retry logic |
| `execution` | `sandbox.ts` | Worktree creation/cleanup (integration with git) |
| `tracking` | `logger.ts` | Log file creation, schema compliance, filename format |
| `tracking` | `leaderboard.ts` | Aggregation from multiple log files |
| `cli` | `commands/run.ts` | Flag parsing, dry-run mode, error handling |

### 7.5 Mocking Agent Execution

For tests that need agent output without calling real AI:

```typescript
// tests/mocks/mock-agent.ts
import type { AgentProvider } from '@oac/execution';

export function createMockAgent(
  responses: Map<string, string>
): AgentProvider {
  return {
    id: 'mock-agent',
    name: 'Mock Agent',
    async checkAvailability() {
      return { available: true, version: '1.0.0' };
    },
    execute(params) {
      const response = responses.get(params.prompt) ?? 'no mock response';
      return {
        executionId: params.executionId,
        providerId: 'mock-agent',
        events: (async function* () {
          yield {
            type: 'output' as const,
            content: response,
            stream: 'stdout' as const,
          };
        })(),
        result: Promise.resolve({
          success: true,
          exitCode: 0,
          totalTokensUsed: 1000,
          filesChanged: ['src/index.ts'],
          duration: 5,
        }),
      };
    },
    async estimateTokens() {
      return {
        taskId: '',
        providerId: 'mock-agent',
        contextTokens: 500,
        promptTokens: 200,
        expectedOutputTokens: 300,
        totalEstimatedTokens: 1000,
        confidence: 0.9,
        feasible: true,
      };
    },
    async abort() {},
  };
}
```

---

## 8. CI/CD Pipeline (GitHub Actions)

### 8.1 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22, 23]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        if: matrix.node-version == 22
        with:
          name: coverage
          path: coverage/

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: packages/*/dist/
```

### 8.2 `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
          version: pnpm changeset version
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 8.3 `.github/workflows/dogfood.yml`

Run OAC on itself nightly to catch regressions and generate real contribution data.

```yaml
name: Dogfood (OAC on OAC)

on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:

jobs:
  dogfood:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile && pnpm build
      - name: Run OAC scan on self
        run: |
          node packages/cli/dist/bin/oac.js scan \
            --repo open330/open-agent-contribution \
            --format json > scan-results.json
      - uses: actions/upload-artifact@v4
        with:
          name: dogfood-scan
          path: scan-results.json
```

---

## 9. Biome Configuration (`biome.json`)

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "warn",
          "options": { "maxAllowedComplexity": 25 }
        }
      },
      "suspicious": { "noExplicitAny": "warn" },
      "style": { "useConst": "error", "noNonNullAssertion": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.oac/**"]
  }
}
```

---

## 10. Additional TypeScript Interfaces

These supplement the Architecture doc's interfaces with dashboard-specific and CLI-specific types.

### 10.1 Run Status (dashboard + CLI `oac status`)

```typescript
export interface RunStatus {
  runId: string;
  state: 'idle' | 'scanning' | 'planning' | 'executing' | 'completing' | 'done' | 'aborted';
  repo: string;
  startedAt: string;
  elapsed: number;         // seconds
  budget: {
    total: number;
    used: number;
    remaining: number;
  };
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  currentJobs: JobSummary[];
}

export interface JobSummary {
  jobId: string;
  taskTitle: string;
  agent: string;
  status: JobStatus;
  tokensUsed: number;
  elapsed: number;
  prUrl?: string;
}
```

### 10.2 CLI Output Formatter

```typescript
export type OutputFormat = 'table' | 'json' | 'md';

export interface CLIContext {
  format: OutputFormat;
  verbose: boolean;
  color: boolean;
  json: boolean; // shorthand for format === 'json'
}
```

### 10.3 Dashboard Config (extended)

```typescript
export interface DashboardConfig {
  port: number;
  openBrowser: boolean;
  /** Hostname to bind (default: localhost) */
  host: string;
  /** Enable CORS for external tools */
  cors: boolean;
  /** API key for dashboard access (optional, for shared machines) */
  apiKey?: string;
}
```

---

## 11. npm Publishing Scope

| Package | Published | Binary |
|---------|-----------|--------|
| `@oac/core` | Yes | No |
| `@oac/repo` | Yes | No |
| `@oac/discovery` | Yes | No |
| `@oac/budget` | Yes | No |
| `@oac/execution` | Yes | No |
| `@oac/completion` | Yes | No |
| `@oac/tracking` | Yes | No |
| `@oac/cli` | Yes | `oac` |
| `@oac/dashboard` | Yes | No |

Users install with: `npm install -g @oac/cli` (which pulls all workspace deps).

---

## 12. Open Questions for Implementation

1. **Ink vs. plain Commander output:** Ink provides richer TUI but adds React as a CLI dependency. Consider starting with plain chalk/ora for v0.1 and adding Ink for v0.2 `oac status --watch`.

2. **better-sqlite3 native dependency:** This requires node-gyp compilation which can fail on some systems. Alternative: use a JSON file cache for v0.1, migrate to SQLite in v0.2.

3. **Dashboard bundling:** The React SPA needs to be pre-built and shipped as static assets inside the `@oac/dashboard` npm package. This means `vite build` runs at package publish time, not at user install time.

4. **Agent response parsing:** Each AI agent CLI has different output formats. The adapter layer must handle: Claude Code (JSON-structured output via `--output-format json`), Codex CLI (streaming stdout), OpenCode (TBD). This is the highest-risk integration point.

5. **Fastify vs. Hono:** Gemini's doc suggests Next.js; Architecture doc suggests Fastify. For a localhost-embedded server in a CLI tool, Hono (ultra-lightweight, 14KB) is worth considering as an alternative to Fastify (larger but more mature).

---

*This document was authored as the Implementation/Codex perspective for the OAC multi-agent planning session. It focuses on concrete specs needed to begin coding.*
