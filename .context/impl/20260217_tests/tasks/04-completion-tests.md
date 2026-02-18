# Task: Write unit tests for packages/completion

## Goal
Create comprehensive unit tests for `packages/completion`. Write test files in `packages/completion/tests/`.

## Test Framework
- Vitest (globals enabled)
- Import: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
- Import source using relative paths

## Files to Test

### 1. `packages/completion/tests/diff-validator.test.ts` — Test `validateDiff` function

Mock simple-git:
```typescript
vi.mock('simple-git', () => {
  const mockGit = {
    diffSummary: vi.fn(),
    diff: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    __mockGit: mockGit,
  };
});
```

Test cases:
- Valid diff with small changes returns `{ valid: true, warnings: [], errors: [] }`
- Diff exceeding maxDiffLines returns error
- Diff near 80% of maxDiffLines returns warning
- Zero changed lines returns warning "No changed lines detected"
- Protected file `.env` modified returns error
- Protected file `*.pem` modified returns error
- Forbidden pattern `eval(` in added lines returns error
- Forbidden pattern `child_process` in added lines returns error
- Forbidden patterns only check `+` lines (added), not `-` lines (removed)
- Custom maxDiffLines config is respected
- Custom forbiddenPatterns config replaces defaults
- Custom protectedFiles config replaces defaults
- OacConfig-style config extracts `execution.validation.maxDiffLines`
- Multiple errors are all reported

### 2. `packages/completion/tests/issue-linker.test.ts` — Test `linkIssueToePR` function

```typescript
import { linkIssueToePR } from '../src/issue-linker.js';
```

Mock Octokit:
```typescript
const mockOctokit = {
  issues: {
    get: vi.fn(),
    createComment: vi.fn(),
  },
};
```

Test cases:
- No linkedIssue on task → returns without calling octokit
- Linked issue exists and is open → creates comment with PR URL
- Linked issue is closed → returns without creating comment
- 404 error (issue deleted) → returns silently (non-blocking)
- 410 error (issue gone) → returns silently
- 422 error (validation) → returns silently
- Other errors → throws completionError with PR_CREATION_FAILED code

### 3. `packages/completion/tests/handler.test.ts` — Test `CompletionHandler` class

Mock dependencies:
```typescript
vi.mock('../src/diff-validator.js', () => ({
  validateDiff: vi.fn().mockResolvedValue({ valid: true, warnings: [], errors: [] }),
}));

vi.mock('../src/github-pr.js', () => ({
  pushBranch: vi.fn().mockResolvedValue(undefined),
  createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/o/r/pull/1', number: 1, sha: 'abc123' }),
}));

vi.mock('../src/issue-linker.js', () => ({
  linkIssueToePR: vi.fn().mockResolvedValue(undefined),
}));
```

Test cases:
- `handle()` calls `complete()` internally
- Successful completion returns CompletionResult with prUrl, summary
- Emits pr:created event
- Emits execution:progress events at each stage
- Diff validation failure throws with VALIDATION_DIFF_TOO_LARGE code
- Forbidden pattern failure throws with VALIDATION_FORBIDDEN_PATTERN code
- Issue linking failure is caught and added as warning (doesn't throw)
- External task ref from linkedIssue on task
- External task ref from metadata
- Providers are notified on success

## Important Notes
- Target: 20-30 tests across all files
- Mock ALL network dependencies (Octokit, simple-git)
- Use `createEventBus()` from `@oac/core` for real event bus
- Create helper functions for building test objects (makeTask, makeRepo, etc.)
