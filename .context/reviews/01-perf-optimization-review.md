# Performance Optimization Review — OAC v2026.4.2

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Full codebase — Node.js/TypeScript CLI tool  
**Adaptation note**: This review applies systems performance engineering principles to a Node.js/TypeScript CLI. Sections on GPU/ANE/Metal/SwiftUI are replaced with V8 heap, event loop, async I/O, and worker thread analysis.

---

## 1. Executive Summary

OAC is a **functionally ambitious CLI** with a **performance-unaware implementation**. The code works — but it works the way a first draft works: sequentially where it should be parallel, monolithic where it should be modular, and duplicated where it should be shared. The discovery pipeline reads files one-by-one in a sequential loop when it could batch with bounded concurrency. The execution engine has a proper PQueue but the epic pipeline above it runs sequentially in a `for...of` loop. A 1,680-line command file (`run.ts`) mixes orchestration, PR creation, simulation, formatting, and utility functions in a single module. Eleven helper functions are copy-pasted across 7+ command files. Dead code exists. A worktree mutex has a double-execution bug on rejection. None of this will crash a user's machine — but it means OAC is slower than it needs to be, harder to maintain than it should be, and carrying technical debt that compounds with every feature added.

**Efficiency score: 4/10** — Functional but unoptimized. No catastrophic bugs, but significant waste in I/O patterns, concurrency utilization, and code organization.

---

## 2. Memory Profile

### V8 Heap Patterns

- **File content buffering in analyzer.ts**: `analyzeFile` reads entire file contents into a string via `readFile(absPath, 'utf-8')` for regex-based export/import extraction. For large files (bundled outputs, generated code, vendor files), this creates large string allocations on the V8 heap that survive until GC collects them. No streaming alternative is used.
- **Scanner results accumulation**: `runScanners` in `analyzer.ts` accumulates all scanner results into an in-memory array before writing atomically via `atomicWriteJson`. For repos with thousands of issues, this could grow the heap significantly.
- **Contribution log loading**: `readContributionLogs` in `leaderboard.ts` and `log.ts` reads all contribution JSON files into memory, parses them, and sorts. No pagination or streaming. At scale (thousands of contributions), this is a linear memory growth vector.

### Module-Level Singletons

- **`claudeCounter` / `codexCounter`** in `estimator.ts`: Module-level token counters persist for the process lifetime. Not a leak — but not resettable between runs in a long-lived process (e.g., dashboard mode). Minor concern.
- **`worktreeLock`** in `sandbox.ts`: Module-level Promise chain. Each chained `.then()` holds a reference to the previous promise. In theory, resolved promises should be GC'd, but the chain pattern means the variable always points to the latest promise in the chain.

### Scaling Projection

For a repo with 10,000 source files:
- Analyzer file walk: ~10,000 sequential `readFile` calls, each buffering full file content. Peak heap depends on largest file size, but GC pressure is high due to rapid allocation/deallocation of string buffers.
- Token estimation: Uses `Promise.all` for parallel reads (good) — but 10,000 concurrent reads would overwhelm the fd limit. Needs bounded concurrency.

**Verdict**: No memory leaks detected, but allocation patterns are wasteful. The analyzer's sequential read-then-regex pattern is the primary concern.

---

## 3. CPU Utilization Report

### Event Loop Analysis

- **Sequential file walking** (`analyzer.ts` lines ~130-180): `walkSourceFiles` is a recursive async function that `await`s each `readdir` call, then `await`s each recursive subdirectory walk. This serializes directory traversal — only one `readdir` is in-flight at any time. On a repo with deep nesting, this means the event loop is idle between each I/O completion.
- **Sequential file analysis** (`analyzer.ts` lines ~200-230): The `analyzeFile` loop iterates source files with `for (const absPath of allFiles)` and `await`s each file read + regex extraction. This is the **single largest CPU/I/O bottleneck** in the codebase. On 10,000 files, this is 10,000 sequential async operations when they could be batched with `p-queue` or `Promise.all` with bounded concurrency.

### Concurrency Model

- **PQueue in ExecutionEngine** (`engine.ts`): Well-configured with `concurrency` and `intervalCap` from config. Priority-based scheduling. This is the **best-designed concurrency primitive** in the codebase.
- **`runWithConcurrency`** (`run.ts` lines 1600-1628): Custom worker pool using shared `nextIndex` counter. Safe in single-threaded JS (no race condition), but reinvents what `p-queue` already provides. Exists in the same file that imports `p-queue` indirectly through the engine.
- **Epic pipeline is sequential** (`run.ts` line ~488): `for (const epic of epics)` with `await` — epics execute one at a time even though they are independent units of work. The `runWithConcurrency` function exists in the same file but is not used for epic execution.

### Async Patterns

- **doctor.ts uses raw `spawn`**: While every other module uses `execa`, `doctor.ts` manually implements command execution with `child_process.spawn` and manual stdout/stderr buffering. This is not a performance issue per se, but it's inconsistent and the manual implementation lacks timeout handling.

**Verdict**: The codebase underutilizes available concurrency. The analyzer is fully sequential. The epic pipeline is fully sequential. Only the task execution engine uses proper concurrent scheduling.

---

## 4. I/O & Data Flow Analysis

### File System Patterns

| Pattern | Location | Assessment |
|---------|----------|------------|
| Sequential file read | `analyzer.ts` analyzeFile loop | ★ Bottleneck — should batch with bounded concurrency |
| Parallel file read | `estimator.ts` Promise.all | ✓ Good — but unbounded, needs concurrency limit |
| Atomic JSON write | `analyzer.ts` atomicWriteJson | ✓ Good — tmp file + rename prevents corruption |
| Context loading | `analyzer.ts` loadContext | ✓ Good — uses Promise.all |
| Status file polling | `status.ts` setInterval | ⚠️ Polls with setInterval, no cleanup on error |

### Git Operations

- **simple-git**: Used throughout for git operations. Each operation spawns a child process. Sequential git operations in the pipeline (clone → branch → worktree → commit → push) are inherently serial — this is correct.
- **Worktree creation**: `sandbox.ts` serializes worktree creation with a mutex. Correct — git worktree operations are not concurrent-safe.

### Process Spawning

- **Agent execution**: `claude-code.adapter.ts` and `codex.adapter.ts` spawn agent CLIs as child processes with streaming stdout. Proper event stream parsing with `for await...of`. Good pattern.
- **PR creation via `gh` CLI**: Spawns `gh pr create` with proper env token forwarding. No timeout protection — if `gh` hangs, the pipeline hangs.

**Verdict**: I/O patterns are a mixed bag. The estimator does parallel reads (good but unbounded). The analyzer does everything sequentially (bad). Git operations are correctly serialized. Agent spawning is well-implemented.

---

## 5. Critical Performance Bugs

### ★★★ Sequential File Analysis in Discovery Pipeline

**Location**: `src/discovery/analyzer.ts` — `walkSourceFiles` and the `analyzeFile` loop
**Impact**: Linear slowdown proportional to file count. On a 10,000-file repo, this means 10,000 sequential `readdir`/`readFile` operations where batched concurrent reads (bounded to ~50-100 concurrent) would be 10-50× faster.
**Fix**: Replace the sequential `for...of` loop with `p-queue` (already a dependency) bounded to 50-100 concurrent file reads. Replace recursive sequential `walkSourceFiles` with parallel directory traversal.

### ★★ Epic Pipeline Runs Sequentially

**Location**: `src/cli/commands/run.ts` line ~488
**Impact**: Epics are independent units of work. Running them sequentially means a 5-epic run takes 5× the time of the longest epic, not 1× with concurrency. The `runWithConcurrency` function exists in the same file (lines 1600-1628) but is not used for epic execution.
**Fix**: Execute epics through `runWithConcurrency` or the existing `PQueue` in `ExecutionEngine`.

### ★ No Timeout on PR Creation

**Location**: `src/cli/commands/run.ts` — `gh pr create` spawn
**Impact**: If the `gh` CLI hangs (network issue, auth prompt), the entire pipeline hangs indefinitely. The `withTimeout` utility function exists in the same file (lines 1630-1647) but is **never called anywhere**.
**Fix**: Wrap `gh` process spawning with `withTimeout`. Consider applying timeout protection to all external process calls.

### ★ Unbounded Parallel File Reads in Estimator

**Location**: `src/budget/estimator.ts` — `Promise.all` for file reading
**Impact**: For large repos, `Promise.all(files.map(f => readFile(f)))` opens thousands of file descriptors simultaneously, potentially hitting OS fd limits (default 256 on macOS). Will cause `EMFILE: too many open files` errors on repos with >250 files being estimated.
**Fix**: Use `p-queue` with concurrency limit of ~50-100.

---

## 6. Defect & Bug-Prone Code Report

### 🐛 `withWorktreeLock` Double-Execution on Rejection

**Location**: `src/execution/sandbox.ts` — `withWorktreeLock` function
**Code pattern**: `worktreeLock = worktreeLock.then(fn, fn)`
**Bug**: The second argument to `.then()` is the rejection handler. If the previous promise in the chain rejects, `fn` is called as the rejection handler — meaning the operation executes even when it should have waited for a clean lock state. If `fn` itself throws, the subsequent `.then(() => {}, () => {})` swallows the error silently.
**Impact**: Under failure conditions, a worktree operation could execute twice or execute against corrupted state.
**Fix**: Use `worktreeLock = worktreeLock.catch(() => {}).then(fn)` — always recover from previous failures before executing the next operation.

### ⚠️ Silent Error Swallowing

**Locations**: Multiple `catch` blocks across the codebase
**Pattern**: `catch (e) { /* log and continue */ }` or `try?`-equivalent patterns where errors are caught and suppressed without user notification.
**Impact**: Failed operations appear successful. A user won't know something went wrong until they check results manually.

### ⚠️ `setInterval` Leak in Status Watch Mode

**Location**: `src/cli/commands/status.ts` — watch mode
**Pattern**: `setInterval` is used for polling status file, but there's no `clearInterval` on process exit or SIGINT handler.
**Impact**: On Ctrl+C, the interval may fire after cleanup has started, causing unexpected writes to a terminal that's being torn down.

### ⚠️ `withTimeout` Defined but Never Used

**Location**: `src/cli/commands/run.ts` lines 1630-1647
**Impact**: Dead code. The function was presumably written for timeout protection but never integrated. Meanwhile, external process calls (`gh pr create`, agent CLI execution) have no timeout protection.

### ⚠️ Module-Level Singletons Not Resettable

**Location**: `src/budget/estimator.ts` — `claudeCounter`, `codexCounter`
**Impact**: In a long-running process (e.g., dashboard mode serving multiple runs), token counters accumulate across runs. No reset mechanism exists.

---

## 7. Architecture Assessment

### Module Structure — Reasonable

The 9-module architecture (Core, Repo, Discovery, Budget, Execution, Completion, Tracking, CLI, Dashboard) is reasonable for the project's scope. Module boundaries are generally clean.

### The `run.ts` Monolith — 1,680 Lines

`src/cli/commands/run.ts` is **far too large** for a single file. It contains:
- Full pipeline orchestration (scan → group → plan → execute → PR → track)
- Epic-based execution path
- Task-based fallback execution path
- Simulated execution fallback
- PR creation logic
- Token estimation helpers
- Formatting utilities
- Concurrency utilities (`runWithConcurrency`, `withTimeout`)
- 11+ duplicated helper functions

This file should be decomposed into:
- `run-pipeline.ts` — orchestration
- `run-epic.ts` — epic execution
- `run-pr.ts` — PR creation
- `run-simulation.ts` — simulated execution (or removed)
- Shared utilities extracted to `src/cli/shared/`

### Event Bus — Clean

`src/core/event-bus.ts` is 29 lines of well-typed EventEmitter3 usage. No concerns.

### Error System — Good Design

`src/core/errors.ts` provides structured, typed errors with factory functions. The `normalizeError` method in `engine.ts` that converts unknown errors to typed `OacError` via regex matching is pragmatic and effective.

### Config System — Solid

Zod schemas in `config.ts` provide runtime validation with good defaults. The `defineConfig` pattern is standard.

---

## 8. Code Quality Report

### ★★★ Massive Helper Function Duplication

This is the **worst code quality issue** in the codebase. The following functions are copy-pasted across multiple command files:

| Function | Duplicated in |
|----------|---------------|
| `getGlobalOptions` | init, doctor, scan, analyze, plan, run, status, log, leaderboard (9 files) |
| `createUi` | scan, analyze, plan, run, status (5 files) |
| `createSpinner` | scan, analyze, plan, run (4 files) |
| `parseInteger` | scan, plan, run, log, leaderboard (5 files) |
| `truncate` | scan, analyze, plan, run (4 files) |
| `formatInteger` | plan, run, log, leaderboard (4 files) |
| `resolveRepoInput` | scan, analyze, plan, run (4 files) |
| `loadOptionalConfig` | scan, analyze, plan, run (4 files) |
| `resolveProviderId` | plan, run (2 files) |
| `resolveBudget` | plan, run (2 files) |
| `estimateTaskMap` | plan, run (2 files) |

**Impact**: ~200-300 lines of duplicated code. Any bug fix must be applied in 4-9 places. Any signature change requires updating 4-9 call sites. This is the primary maintenance burden of the codebase.

**Fix**: Extract all shared helpers to `src/cli/shared/helpers.ts` or granular modules under `src/cli/shared/`.

### Dead Code

- `withTimeout` in `run.ts` — defined, never called
- Various commented-out or unused imports across command files

### Naming

- Generally consistent camelCase for functions, PascalCase for types ✓
- Scanner naming inconsistency: config uses `testGap` (camelCase) but some references use `test-gap` (kebab-case) ⚠️
- `simulateExecution` is well-named but its existence is a UX problem (see Section 5)

### Formatting

- Biome is configured for linting/formatting ✓
- Consistent style across files ✓

---

## 9. Prioritized Optimizations

### Tier 0 — Blocking

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| T0-1 | `withWorktreeLock` double-execution on rejection | `sandbox.ts` | Potential data corruption under failure |
| T0-2 | Unbounded `Promise.all` in estimator hits fd limit | `estimator.ts` | `EMFILE` crash on repos with >250 files |

### Tier 1 — High Impact

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| T1-1 | Sequential file analysis in discovery pipeline | `analyzer.ts` | 10-50× slower than necessary on large repos |
| T1-2 | Epic pipeline runs sequentially | `run.ts` line ~488 | Total run time = sum of all epics instead of max |
| T1-3 | Extract duplicated helpers to shared module | All command files | ~300 lines of duplicated code to maintain |
| T1-4 | Decompose `run.ts` (1,680 lines) | `run.ts` | Unmaintainable monolith |

### Tier 2 — Efficiency

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| T2-1 | Add timeout protection to external process calls | `run.ts`, agent adapters | Pipeline hangs on network issues |
| T2-2 | Use `withTimeout` (or remove it) | `run.ts` | Dead code |
| T2-3 | Replace `spawn` with `execa` in doctor.ts | `doctor.ts` | Inconsistency, missing timeout handling |
| T2-4 | Add SIGINT handler to status watch mode | `status.ts` | Interval leak on Ctrl+C |
| T2-5 | Parallel directory traversal in `walkSourceFiles` | `analyzer.ts` | Slow on deeply nested repos |

### Tier 3 — Polish

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| T3-1 | Stream large file reads in analyzer instead of buffering | `analyzer.ts` | Reduces V8 heap pressure |
| T3-2 | Add resettable token counters | `estimator.ts` | Correctness in long-lived processes |
| T3-3 | Use `p-queue` instead of custom `runWithConcurrency` | `run.ts` | Code reuse, better error handling |
| T3-4 | Add memory pressure monitoring for long runs | General | Prevents OOM on resource-constrained machines |

---

## 10. Final Verdict

**Score: 4/10**

OAC is a **working prototype with prototype-level performance characteristics**. The execution engine (`engine.ts` with PQueue) shows that the author understands concurrent scheduling — but this discipline wasn't applied to the discovery pipeline or the epic orchestration layer. The codebase has one genuinely dangerous bug (`withWorktreeLock` double-execution), one crash vector (unbounded `Promise.all`), and significant optimization opportunities in the file analysis pipeline.

**The biggest wins for the least effort**:
1. Fix `withWorktreeLock` (5 minutes, prevents data corruption)
2. Bound the `Promise.all` in estimator (10 minutes, prevents EMFILE crashes)
3. Parallelize the analyzer's file loop with `p-queue` (1 hour, 10-50× speedup on large repos)
4. Extract duplicated helpers to shared module (2 hours, pays dividends on every future change)

**Hardware requirements**: Node.js 24+, no unusual requirements. Memory usage is acceptable for typical repo sizes (<10K files). CPU utilization is poor due to sequential patterns but doesn't cause failures.

**Scaling limit**: The sequential analyzer becomes the bottleneck at ~5,000 files. The unbounded `Promise.all` in the estimator crashes at ~250 files (OS fd limit). The epic pipeline's sequential execution means total run time scales linearly with epic count.

**Path to optimal**: Fix the Tier 0 bugs immediately. Implement Tier 1 optimizations to achieve acceptable performance at scale. The architecture is sound enough that these fixes don't require rewrites — they're targeted improvements to specific bottlenecks.

