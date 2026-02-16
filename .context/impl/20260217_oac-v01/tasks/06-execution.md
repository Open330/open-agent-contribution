# Task: Implement packages/execution

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` sections 4.1, 9 for architecture.
Read `packages/core/src/types.ts` and `packages/core/src/event-bus.ts` for shared types.

## Deliverables

Implement in `packages/execution/src/`:

### 1. `agents/agent.interface.ts` — Agent Provider Interface
```typescript
export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly name: string;
  checkAvailability(): Promise<AgentAvailability>;
  execute(params: AgentExecuteParams): AgentExecution;
  estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;
  abort(executionId: string): Promise<void>;
}
```
- Define AgentAvailability, AgentExecuteParams, AgentExecution, AgentEvent, AgentResult interfaces
- AgentExecution must have `events: AsyncIterable<AgentEvent>` and `result: Promise<AgentResult>`

### 2. `agents/claude-code.adapter.ts` — Claude Code Adapter
- Implement AgentProvider for Claude Code CLI
- Use `execa` to spawn `claude` process
- Parse stdout for token usage events
- Support abort via process.kill()
- checkAvailability: run `claude --version`

### 3. `sandbox.ts` — Git Worktree Sandbox
- `createSandbox(repoPath, branchName, baseBranch): Promise<SandboxContext>`
- Use `simple-git` to create worktree: `git worktree add <path> -b <branch> origin/<base>`
- Return { path, branchName, cleanup() }
- cleanup removes the worktree

### 4. `worker.ts` — Single Agent Worker
- `executeTask(agent, task, sandbox, eventBus): Promise<ExecutionResult>`
- Builds prompt from task description
- Calls agent.execute() in sandbox directory
- Streams AgentEvents to event bus
- Returns ExecutionResult with files changed, tokens used, etc.

### 5. `engine.ts` — Execution Engine with Job Queue
- Use `p-queue` for priority queue with concurrency control
- `ExecutionEngine` class with: enqueue(plan), run(), abort()
- Default concurrency: 2
- Retry logic: max 2 attempts for transient errors
- Emit events to OacEventBus for each job lifecycle change

### 6. `index.ts` — Re-export everything

## Dependencies
- @oac/core (workspace:*) — types, event bus, errors
- execa ^9.5.2
- p-queue ^8.1.0
- simple-git ^3.27.0 (for sandbox)
