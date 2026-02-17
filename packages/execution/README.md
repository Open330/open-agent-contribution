# @open330/oac-execution

Agent execution engine for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-execution
```

## What's Inside

- **ExecutionEngine** — priority-based job queue with `p-queue`, retry, and abort support
- **ClaudeCodeAdapter** — `AgentProvider` implementation for Claude Code CLI (`claude-code`)
- **CodexAdapter** — `AgentProvider` implementation for OpenAI Codex CLI (`codex`)
- **Git Worktree Sandbox** — isolated execution environments per task via `git worktree`

## Usage

```typescript
import { ClaudeCodeAdapter, CodexAdapter, createSandbox, executeTask } from '@open330/oac-execution';

// Use Claude Code
const claude = new ClaudeCodeAdapter();
// Or use Codex
const codex = new CodexAdapter();

const sandbox = await createSandbox(repo, task);
const result = await executeTask(claude, task, sandbox);
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
