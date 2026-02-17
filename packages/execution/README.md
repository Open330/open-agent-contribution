# @open330/oac-execution

Agent execution engine for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-execution
```

## What's Inside

- **ExecutionEngine** — priority-based job queue with `p-queue`, retry, and abort support
- **CodexAdapter** — `AgentProvider` implementation for OpenAI Codex CLI
- **Git Worktree Sandbox** — isolated execution environments per task via `git worktree`

## Usage

```typescript
import { CodexAdapter, createSandbox, executeTask } from '@open330/oac-execution';

const adapter = new CodexAdapter();
const sandbox = await createSandbox(repo, task);
const result = await executeTask(adapter, task, sandbox);
```

## Adding Custom Agents

Implement the `AgentProvider` interface:

```typescript
import type { AgentProvider } from '@open330/oac-execution';

export class MyAgent implements AgentProvider {
  readonly id = 'my-agent';
  readonly name = 'My Agent';
  async checkAvailability() { /* ... */ }
  execute(params) { /* ... */ }
  async estimateTokens(params) { /* ... */ }
  async abort(executionId) { /* ... */ }
}
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
