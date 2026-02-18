# Task: Write unit tests for packages/execution

## Goal
Create comprehensive unit tests for `packages/execution`. Write test files in `packages/execution/tests/`.

## Test Framework
- Vitest (globals enabled)
- Import: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
- Import source using relative paths

## Files to Test

### 1. `packages/execution/tests/engine.test.ts` — Test `ExecutionEngine` class

The engine manages a job queue with p-queue. Test with mocked agents and sandbox.

Key imports and types:
```typescript
import { ExecutionEngine, isTransientError, type Job } from '../src/engine.js';
import type { AgentProvider } from '../src/agents/agent.interface.js';
import { createEventBus } from '@oac/core';
import { OacError } from '@oac/core';
```

Mock modules:
```typescript
vi.mock('../src/sandbox.js', () => ({
  createSandbox: vi.fn().mockResolvedValue({
    path: '/tmp/sandbox',
    branchName: 'oac/test',
    cleanup: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../src/worker.js', () => ({
  executeTask: vi.fn().mockResolvedValue({
    success: true,
    exitCode: 0,
    totalTokensUsed: 1000,
    filesChanged: ['file.ts'],
    duration: 5000,
  }),
}));
```

Create mock agent:
```typescript
function createMockAgent(id = 'test-agent'): AgentProvider {
  return {
    id,
    name: 'Test Agent',
    checkAvailability: vi.fn().mockResolvedValue({ available: true, version: '1.0.0' }),
    execute: vi.fn().mockReturnValue({
      events: (async function* () {})(),
      result: Promise.resolve({ success: true, exitCode: 0, totalTokensUsed: 0, filesChanged: [], duration: 0 }),
      abort: vi.fn(),
    }),
    estimateTokens: vi.fn().mockResolvedValue(1000),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}
```

Test cases:
- Constructor throws if no agents provided
- Constructor accepts config with defaults
- `enqueue()` creates jobs from execution plan
- `enqueue()` returns array of Job objects with status 'queued'
- `run()` processes all queued jobs
- `run()` returns RunResult with completed/failed/aborted arrays
- `abort()` stops all running jobs
- `abort()` marks queued jobs as aborted
- `isTransientError()` returns true for AGENT_TIMEOUT, AGENT_OOM, NETWORK_ERROR, GIT_LOCK_FAILED
- `isTransientError()` returns false for other error codes
- Branch name includes date, task id segment, and attempt number
- Agent selection round-robins across available agents

Create mock execution plan:
```typescript
function makePlan() {
  return {
    totalBudget: 50000,
    selectedTasks: [{
      task: makeTask(),
      estimate: makeEstimate(),
      cumulativeBudgetUsed: 5000,
    }],
    deferredTasks: [],
    reserveTokens: 5000,
    remainingTokens: 40000,
  };
}
```

### 2. `packages/execution/tests/worker.test.ts` — Test worker helper functions

The worker module has several testable pure functions (though some are not exported directly).
Focus on testing `executeTask` with mocked agent and sandbox.

Test cases:
- `executeTask` calls agent.execute with correct prompt
- `executeTask` returns ExecutionResult on success
- `executeTask` tracks tokens from events
- `executeTask` tracks file edits from events
- `executeTask` emits execution:progress events
- Timeout error is normalized to AGENT_TIMEOUT OacError
- Generic error is normalized to AGENT_EXECUTION_FAILED
- Task prompt includes task id, title, source, target files

## Important Notes
- Target: 15-25 tests total
- Mock ALL external dependencies (sandbox, p-queue behavior, agents)
- Keep tests synchronous where possible
- Use `createEventBus()` from `@oac/core` for real event bus instances
