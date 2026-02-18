# Task: Fix Critical Performance Bugs (T0-1, T0-2)

## Overview
Fix two Tier 0 blocking performance bugs: worktree lock double-execution and unbounded Promise.all.

## Task 1: Fix `withWorktreeLock` double-execution on rejection

**File**: `src/execution/sandbox.ts`

**Current code (BUGGY)**:
```typescript
function withWorktreeLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = worktreeLock.then(fn, fn);
  worktreeLock = next.then(
    () => {},
    () => {},
  );
  return next;
}
```

**Bug**: `.then(fn, fn)` passes `fn` as BOTH the fulfillment and rejection handler. If the previous promise in the chain rejects, `fn` executes as the rejection handler — meaning operations run even after failures. If `fn` throws, the subsequent `.then(() => {}, () => {})` silently swallows the error.

**Fix**: Replace with:
```typescript
function withWorktreeLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = worktreeLock.catch(() => {}).then(fn);
  worktreeLock = next.then(
    () => {},
    () => {},
  );
  return next;
}
```

This ensures: (1) previous failures are recovered from before executing `fn`, (2) `fn` is only called as a fulfillment handler, (3) errors from `fn` propagate correctly to the caller.

## Task 2: Bound `Promise.all` in estimator.ts with p-queue

**File**: `src/budget/estimator.ts`

**Current code (CRASHES on large repos)**:
```typescript
// Line ~183-185 in estimateTokens()
const fileResults = await Promise.all(
  uniqueTargetFiles.map((targetFile) => readContextFile(targetFile, counter)),
);

// Line ~266-268 in estimateEpicTokens()
const subtaskEstimates = await Promise.all(
  epic.subtasks.map((task) => estimateTokens(task, provider)),
);
```

**Bug**: On repos with >250 files, unbounded `Promise.all` opens too many file descriptors simultaneously, causing `EMFILE: too many open files` on macOS (fd limit = 256).

**Fix**:
1. Import `PQueue` from `p-queue` (already a project dependency)
2. Replace both `Promise.all` calls with bounded concurrency:

```typescript
import PQueue from "p-queue";

// In estimateTokens():
const queue = new PQueue({ concurrency: 50 });
const fileResults = await Promise.all(
  uniqueTargetFiles.map((targetFile) => queue.add(() => readContextFile(targetFile, counter))),
);

// In estimateEpicTokens():
const epicQueue = new PQueue({ concurrency: 10 });
const subtaskEstimates = await Promise.all(
  epic.subtasks.map((task) => epicQueue.add(() => estimateTokens(task, provider))),
);
```

## Verification
- Run `pnpm build` to ensure no type errors
- Run `pnpm test` if tests exist for these modules
- Ensure `p-queue` import matches existing usage pattern in `src/execution/engine.ts`

## MUST NOT
- Change any function signatures
- Modify any other files
- Add new dependencies (p-queue is already installed)
- Change the behavior beyond fixing the specific bugs

