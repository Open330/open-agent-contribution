# @open330/oac-budget

Token estimation and execution planning for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-budget
```

## What's Inside

- **Token Estimator** — per-provider token counting using tiktoken
- **Complexity Analyzer** — estimates LOC changes and task difficulty
- **Execution Planner** — knapsack-optimized task selection within a token budget (with 10% reserve)

## Usage

```typescript
import { estimateTokens, buildExecutionPlan } from '@open330/oac-budget';

const estimate = estimateTokens(task, 'claude');
const plan = buildExecutionPlan(tasks, { totalBudget: 50_000 });
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
