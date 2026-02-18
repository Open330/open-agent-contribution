# Performance Optimization Review — Round 4 — OAC v2026.5.0

**Reviewer**: perf-optimization-reviewer  
**Date**: 2026-02-18  
**Scope**: Re-evaluation after Wave 5 (run.ts monolith decomposition into run/ directory)  
**Previous review**: `05-perf-optimization-review-r3.md` (Score: 8/10)

---

## 1. Executive Summary

Wave 5 addressed the single most pressing architectural concern from Round 3: the 1,691-line `run.ts` monolith. The file has been decomposed into 8 focused modules under `src/cli/commands/run/`:

| Module | Lines | Responsibility |
|--------|------:|----------------|
| `types.ts` | 102 | Shared interfaces, constants (`DEFAULT_TIMEOUT_SECONDS`, `PR_CREATION_TIMEOUT_MS`), utility functions (`formatBudgetDisplay`, `formatDuration`) |
| `pr.ts` | 105 | PR creation with 2-min timeout — isolated, testable |
| `tracking.ts` | 175 | Contribution log writing, GitHub username resolution |
| `task.ts` | 547 | Task discovery, execution plan, agent dispatch, rendering |
| `epic.ts` | 393 | Epic-based execution pipeline with PQueue concurrency |
| `retry.ts` | 142 | Retry failed tasks from contribution logs |
| `pipeline.ts` | 229 | Main orchestration, config resolution, auth warnings |
| `index.ts` | 52 | Commander command definition — public API surface |
| **Total** | **1,745** | |

The dependency graph is clean and acyclic:
```
types.ts      ← imported by ALL other files
pr.ts         ← imported by epic.ts, task.ts
tracking.ts   ← imported by pipeline.ts, epic.ts, retry.ts
task.ts       ← imported by pipeline.ts, epic.ts, retry.ts
epic.ts       ← imported by pipeline.ts
retry.ts      ← imported by pipeline.ts
pipeline.ts   ← imported by index.ts
index.ts      ← imported by cli.ts
```

No circular dependencies. Each module has a single clear responsibility. The largest file (`task.ts` at 547 lines) handles task discovery through execution — a natural unit of work that would be awkward to split further without introducing unnecessary indirection.

**Efficiency score: 9/10** — Up from 8/10. The monolith that was the #1 concern across all three previous rounds is cleanly decomposed. The codebase now has uniform concurrency (PQueue), timeout protection, recovery from failures, and modular architecture.

---

## 2. Issue-by-Issue Resolution Status

### Tier 0 — Blocking (ALL RESOLVED ✅ — unchanged since R1)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T0-1 | `withWorktreeLock` double-execution | ✅ Fixed (Wave 1) | Stable |
| T0-2 | Unbounded `Promise.all` in estimator | ✅ Fixed (Wave 1) | Stable |

### Tier 1 — High Impact (ALL RESOLVED ✅)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T1-1 | Sequential file analysis | ✅ Fixed (Wave 2) | Stable |
| T1-2 | Epic pipeline sequential | ✅ Fixed (Wave 3) | Stable |
| T1-3 | Duplicated helpers | ✅ Fixed (Wave 2) | Stable |
| T1-4 | `run.ts` monolith | ✅ Fixed (Wave 5) | 1,691 lines → 8 modules in `run/` directory. Largest file is `task.ts` at 547 lines — within acceptable bounds for a cohesive unit |

### Tier 2 — Efficiency (ALL RESOLVED ✅ — unchanged since R3)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T2-1 | No timeout on PR creation | ✅ Fixed (Wave 4) | Stable |
| T2-2 | Dead `withTimeout` function | ✅ Fixed (Wave 2) | Stable |
| T2-3 | `spawn` → `execa` in doctor.ts | ✅ Fixed (Wave 1) | Stable |
| T2-4 | SIGINT handler in status watch | ✅ Fixed (Wave 1) | Stable |
| T2-5 | Parallel directory traversal | ✅ Fixed (Wave 2) | Stable |
| T2-6 | `runWithConcurrency` → PQueue | ✅ Fixed (Wave 4) | Stable |

### Tier 3 — Polish (0/3 RESOLVED — unchanged)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| T3-1 | Stream large file reads in analyzer | ❌ Open | Low priority — typical source files fit comfortably in memory |
| T3-2 | Resettable token counters | ❌ Open | Module-level singletons — correctness issue in long-lived processes only |
| T3-4 | Memory pressure monitoring | ❌ Open | Low priority for a CLI tool with bounded concurrency |

---

## 3. New Observations (Post-Wave 5)

### Positive Changes

1. **Clean module boundaries**: Each file in `run/` has a clear import/export surface. `types.ts` is the shared foundation, `pipeline.ts` is the orchestrator that wires everything together, and `index.ts` is the thin public API. This is textbook module decomposition.

2. **Testability improved**: Individual functions like `createPullRequest()` (in `pr.ts`), `runRetryPipeline()` (in `retry.ts`), and `discoverTasks()` (in `task.ts`) are now independently importable and testable without pulling in the entire pipeline. This lowers the barrier to adding focused unit tests.

3. **No runtime behavior change**: Build passes clean, 354/354 tests pass unchanged. The decomposition is purely structural — zero functional regression risk.

4. **Import path discipline**: Uses `NodeNext` module resolution correctly — `cli.ts` imports `./commands/run/index.js` explicitly. Internal imports within `run/` use `./types.js`, `./pr.js`, etc. No barrel re-export tricks that would break tree-shaking.

5. **`task.ts` at 547 lines is acceptable**: The largest module handles a cohesive workflow: task discovery → plan rendering → execution → result rendering. Splitting this further would require passing context objects between too many tiny files, adding complexity without improving clarity.

### Minor Observations

1. **`task.ts` could benefit from a `renderTaskResults` extraction**: The render functions (`renderSelectedPlanTable`, `renderTaskResults`, `printFinalSummary`) total ~150 lines and could be a separate `task-render.ts` if the file grows further. Not urgent — the current size is manageable.

2. **`epic.ts` has its own render functions too**: `renderEpicPlanTable`, `printEpicSummary`, `printEpicDryRun` — same pattern as task.ts. Consistent, which is good.

---

## 4. Revised Prioritized Optimizations

### Tier 3 — Polish (only remaining items)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| T3-1 | Streaming file reads in analyzer | `analyzer.ts` | 2-3 hours | Minor heap improvement for very large source files |
| T3-2 | Resettable token counters | `estimator.ts` | 30 min | Correctness in long-lived processes |
| T3-4 | Memory pressure monitoring | General | 3-4 hours | Defense against OOM on constrained machines |

All Tier 0, Tier 1, and Tier 2 items are now resolved.

---

## 5. Final Verdict

**Score: 9/10** — Up from 8/10.

The decomposition of `run.ts` was the single most important structural improvement remaining. Every previous round identified this as the top concern — now it's resolved with a clean, acyclic module graph.

**What changed my assessment**:
- The 1,691-line monolith is gone. Replaced by 8 focused modules, each under 550 lines, with clear responsibilities and no circular dependencies.
- The codebase now follows a consistent pattern: each command is either a single file (simple commands like `doctor`, `init`) or a directory with focused modules (complex commands like `run/`).
- Import discipline is correct for `NodeNext` resolution — no implicit index resolution tricks.

**What prevents a 10/10**:
- Tier 3 items remain (streaming reads, resettable counters, memory monitoring). These are genuine improvements but low-priority for a CLI tool that processes source files of typical size.
- `task.ts` at 547 lines is within bounds but bears watching — if more task-related features are added, it should be the next decomposition candidate.

**Path forward**: The structural work is done. The codebase is in excellent shape — clean concurrency (PQueue), timeout protection on all external calls, recovery from partial failures, modular architecture with clear boundaries. The remaining Tier 3 items are polish that can be addressed opportunistically. The next meaningful improvements would be feature-level (e.g., the UX reviewer's request for `scan`/`analyze` clarification) rather than performance architecture.

