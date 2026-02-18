# Task: Write unit tests for packages/discovery

## Goal
Create comprehensive unit tests for `packages/discovery`. Write test files in `packages/discovery/tests/`.

## Test Framework
- Vitest (globals enabled)
- Import: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
- Import source using relative paths: `import { ... } from '../src/ranker.js';`

## Files to Test

### 1. `packages/discovery/tests/ranker.test.ts` — Test `rankTasks` function

The `rankTasks` function is the main export. It scores tasks on 5 dimensions (0-100 total):
- `impactScore` (0-25): based on source type, matchCount, issueCount, linkedIssue
- `feasibilityScore` (0-25): based on complexity, file count, executionMode
- `freshnessScore` (0-15): based on daysSinceLastChange or discoveredAt age
- `issueSignals` (0-15): based on linkedIssue, labels, upvotes, reactions, maintainerComments
- `tokenEfficiency` (0-20): based on complexity, estimatedTokens, targetFiles count, impactScore

Test cases:
- Empty array returns empty array
- Single task gets scored and returned
- Tasks are sorted by priority descending
- Tied priority sorts by title alphabetically
- Impact scoring: lint=22, todo=10, test-gap=24, dead-code=14, github-issue=20, custom=12
- Impact bonus: todo with matchCount >= 4 gets +4, >= 2 gets +2
- Impact bonus: lint with issueCount >= 5 gets +2
- Impact bonus: linkedIssue adds +2
- Feasibility: trivial=25, simple=20, moderate=12, complex=6
- Feasibility penalty: fileCount >= 6 → -8, >= 3 → -4
- Feasibility penalty: direct-commit → -2
- Freshness: daysSinceLastChange <= 3 → 15, <= 14 → 12, <= 30 → 9, <= 90 → 6, <= 180 → 4, > 180 → 2
- Freshness: no metadata → default 7
- Issue signals: linkedIssue adds 5 + min(labels.length, 4)
- Issue signals: good-first-issue +2, help-wanted +1
- Token efficiency by complexity: trivial=18, simple=14, moderate=8, complex=4
- Token efficiency by estimatedTokens: <=1500→20, <=5000→16, <=12000→12, <=25000→8, >25000→4
- All scores are clamped to their respective ranges
- priorityBreakdown is added to metadata

Create a helper to build minimal Task objects:
```typescript
import type { Task, TaskSource, TaskComplexity } from '@oac/core';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task',
    source: 'lint',
    title: 'Test task',
    description: 'A test task',
    targetFiles: ['file.ts'],
    priority: 0,
    complexity: 'trivial',
    executionMode: 'new-pr',
    metadata: {},
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}
```

### 2. `packages/discovery/tests/scanner.test.ts` — Test `CompositeScanner`

Test the composite scanner and deduplication logic.

Test cases:
- Default constructor creates LintScanner + TodoScanner
- Custom constructor accepts array of scanners
- Returns empty array when all scanners return empty
- Collects tasks from multiple scanners
- Handles scanner failures gracefully (Promise.allSettled)
- Deduplication: two tasks with same source+targetFiles+title are merged
- Deduplication: higher priority task wins
- Deduplication: metadata is merged from both tasks
- `maxTasks` option limits results
- Results are sorted by priority descending

Mock scanners:
```typescript
const mockScanner = {
  id: 'mock',
  name: 'Mock Scanner',
  scan: vi.fn().mockResolvedValue([]),
};
```

## Important Notes
- Target: 20-30 tests per file
- Keep tests fast, no I/O needed for ranker tests
- For scanner tests, mock the Scanner interface
