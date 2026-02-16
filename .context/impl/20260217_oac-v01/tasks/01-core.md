# Task: Implement packages/core

## Context
Read the architecture doc at `.context/plans/20260217_oac-service-plan/claude.md` sections 2, 4, 12, 14 for full context.

## Deliverables

Implement the following files in `packages/core/src/`:

### 1. `event-bus.ts` — Typed Event Bus
- Use `eventemitter3` to create a typed OAC event bus
- Define `OacEvents` type map with events: `repo:resolved`, `task:discovered`, `task:selected`, `budget:estimated`, `execution:started`, `execution:progress`, `execution:completed`, `execution:failed`, `pr:created`, `pr:merged`, `run:completed`
- Export `createEventBus()` factory function that returns a typed EventEmitter
- Export the `OacEventBus` type

### 2. `config.ts` — Config Loader with Zod
- Define `OacConfig` zod schema covering: repos, provider (id + options), budget (totalTokens, reservePercent, estimationPadding), discovery (scanners toggles, issueLabels, minPriority, maxTasks, exclude), execution (concurrency, taskTimeout, maxRetries, mode, branchPattern, validation, pr settings), completion (integrations: linear/jira), tracking (directory, autoCommit, gitTracked), dashboard (port, openBrowser)
- Export `defineConfig(config)` helper (passthrough for IDE autocompletion)
- Export `loadConfig()` that resolves config with defaults
- Support environment variable interpolation `${VAR_NAME}` in string values

### 3. `errors.ts` — Error Types
- Define `OacError` class extending Error with: code, severity (fatal/recoverable/warning), context, cause
- Define `OacErrorCode` union type with all error codes from the architecture doc (REPO_NOT_FOUND, SCANNER_FAILED, BUDGET_INSUFFICIENT, AGENT_NOT_AVAILABLE, etc.)
- Export error factory functions: `repoError()`, `discoveryError()`, `budgetError()`, `executionError()`, `completionError()`, `configError()`

### 4. `types.ts` — Shared Types
- `AgentProviderId` type ('claude-code' | 'codex-cli' | 'opencode' | string)
- `TaskSource` type ('lint' | 'todo' | 'test-gap' | 'dead-code' | 'github-issue' | 'custom')
- `TaskComplexity` type ('trivial' | 'simple' | 'moderate' | 'complex')
- `ExecutionMode` type ('new-pr' | 'update-pr' | 'direct-commit')
- `Task` interface with all fields from architecture doc section 4.2
- `TokenEstimate` interface
- `ExecutionPlan` interface
- `ContributionLog` interface
- `RunSummary` interface

### 5. `index.ts` — Re-export everything

## Tech Stack
- eventemitter3 ^5.0.1
- zod ^3.24.2
- TypeScript strict mode, ESM

## Constraints
- No default exports, only named exports
- All types must be exported
- Use zod for runtime validation of config
