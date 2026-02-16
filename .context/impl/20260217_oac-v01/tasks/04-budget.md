# Task: Implement packages/budget

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` section 7 for architecture.

## Deliverables

Implement in `packages/budget/src/`:

### 1. `estimator.ts` — Token Estimator
- `estimateTokens(task: Task, provider: AgentProviderId): Promise<TokenEstimate>`
- Count context tokens from target files using tiktoken
- Add prompt overhead per provider
- Apply complexity multiplier: trivial=0.5x, simple=1.0x, moderate=2.0x, complex=3.5x
- Apply 20% estimation padding
- Return TokenEstimate with confidence score

### 2. `providers/claude-counter.ts` — Claude Token Counter
- Use tiktoken with cl100k_base encoding
- Invocation overhead: 1500 tokens
- Max context: 200,000 tokens

### 3. `providers/codex-counter.ts` — Codex Token Counter
- Use tiktoken with cl100k_base (or o200k_base)
- Invocation overhead: 1000 tokens

### 4. `complexity.ts` — Complexity Analyzer
- Analyze task complexity based on: number of target files, estimated LOC changes, task source
- Map to TaskComplexity enum

### 5. `planner.ts` — Execution Plan Builder
- `buildExecutionPlan(tasks: Task[], estimates: Map<string, TokenEstimate>, budget: number): ExecutionPlan`
- Greedy knapsack: sort by priority/token ratio, fill budget
- 10% reserve for retries
- Return selected tasks + deferred tasks + remaining budget

### 6. `index.ts` — Re-export

## Dependencies
- @oac/core (workspace:*)
- tiktoken ^1.0.18
