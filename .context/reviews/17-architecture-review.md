# Architecture Review — OAC v2026.4.3

**Reviewer**: architecture-reviewer (Principal Software Architect)  
**Date**: 2026-02-18  
**Scope**: Full codebase review (~15,000 LOC across 70+ source files)

---

## Architecture Review

### Summary
- **Overall Assessment**: SOUND
- **Score**: 9.3 / 10
- **Key Strength**: Clean 4-layer architecture with zero circular dependencies across 25 modules
- **Key Concern**: Duplicated infrastructure code across agent adapters (AsyncEventQueue, TokenState) signals a missing shared execution primitives layer

### Dependency Analysis

**Module dependency graph** (25 modules, all acyclic):

```
CLI / Dashboard (presentation)
  └──→ Discovery, Budget, Execution, Completion (domain)
        └──→ Repo, Tracking (infrastructure)
              └──→ Core: Types, Errors, Config, Events (foundation)
```

- **Circular dependencies**: **0** — All 25 inter-module edges flow strictly inward.
- **Layer violations**: **0** — Core never imports from domain or presentation. Domain never imports from presentation.
- **Deepest dependency chain**: CLI → Execution → Core (3 hops). Reasonable for a tool of this size.

The dependency direction is textbook clean architecture. `core/` exports types, errors, config, and events consumed by every other layer. Domain modules (`discovery/`, `budget/`, `execution/`, `completion/`) depend only on `core/` and occasionally on each other (but always in one direction). Presentation (`cli/`, `dashboard/`) sits at the outer ring.

### Design Pattern Assessment

| Pattern | Current State | Recommendation |
|---------|--------------|----------------|
| **Strategy (AgentProvider)** | Clean interface with 2 implementations (claude-code, codex) | ✅ Keep — correctly polymorphic |
| **Factory (resolveAdapter)** | String-keyed switch in `task.ts` | Consider a registry pattern for extensibility |
| **Observer (EventBus)** | Typed EventEmitter3 with well-defined events | ✅ Keep — good event-driven design |
| **Pipeline (run command)** | Decomposed into 8 modules under `commands/run/` | ✅ Keep — clean pipeline stages |
| **Composite (CompositeScanner)** | Aggregates multiple Scanner implementations | ✅ Keep — natural extension point |
| **Template Method (error normalization)** | Regex-based classification, duplicated in 2 places | Extract shared normalizer |

### Findings

#### [HIGH] F1: Duplicated AsyncEventQueue across agent adapters

- **Category**: Coupling / DRY violation
- **Files**: `src/execution/agents/claude-code.adapter.ts:35-120`, `src/execution/agents/codex.adapter.ts:36-120`
- **Description**: The `AsyncEventQueue<T>` class (~90 lines), `TokenState`, and `TokenPatch` interfaces are copy-pasted identically in both adapters.
- **Impact**: Bug fixes or improvements must be applied twice. A future third adapter (OpenCode) would triple the duplication.
- **Recommendation**: Extract to `src/execution/agents/async-event-queue.ts` as a shared module. Both adapters import from it.

#### [HIGH] F2: Duplicated error normalization logic

- **Category**: Consistency
- **Files**: `src/execution/engine.ts:347-427` (`normalizeError`), `src/execution/worker.ts:110-135` (`normalizeExecutionError`)
- **Description**: Both files classify unknown errors by regex matching on the error message, but `engine.ts` handles 5 error types (timeout, OOM, network, git lock, abort) while `worker.ts` handles only 2 (timeout, fallback). The partial duplication means an error caught in the worker gets a different classification than the same error caught in the engine.
- **Impact**: Inconsistent error recovery — a network error in `worker.ts` becomes `AGENT_EXECUTION_FAILED` (non-retryable) instead of `NETWORK_ERROR` (retryable).
- **Recommendation**: Extract a single `normalizeError(error, context)` function to `src/execution/errors.ts`. Both engine and worker import it.

#### [MEDIUM] F3: Scanner construction duplicated between task and epic paths

- **Category**: Cohesion
- **Files**: `src/cli/commands/run/task.ts` (`selectScannersFromConfig`), `src/cli/commands/run/epic.ts` (`buildScannerList`)
- **Description**: Both functions build a list of Scanner instances from config flags, with slightly different logic.
- **Impact**: Adding a new scanner type requires changes in two places.
- **Recommendation**: Extract a single `buildScannersFromConfig(config)` factory into `src/discovery/scanner-factory.ts` or into the existing `scanner.ts`.

#### [MEDIUM] F4: Agent resolution is a hard-coded switch

- **Category**: Extensibility
- **Files**: `src/cli/commands/run/task.ts` (`resolveAdapter`)
- **Description**: The `resolveAdapter` function uses a string-keyed if/else to instantiate the correct adapter. Adding a new agent (e.g., OpenCode) requires modifying this function.
- **Impact**: Violates Open/Closed Principle for a known extension point (the roadmap lists OpenCode support).
- **Recommendation**: Create a lightweight registry (`Map<AgentProviderId, () => AgentProvider>`) populated at startup. `resolveAdapter` becomes a simple lookup.

#### [LOW] F5: Token estimation uses unbounded Promise.all

- **Category**: Resource management
- **Files**: `src/cli/helpers.ts` (`estimateTaskMap`)
- **Description**: `estimateTaskMap` fires all token estimation calls simultaneously with `Promise.all`, bypassing the PQueue pattern used everywhere else.
- **Impact**: For large task lists (50+), this could overwhelm rate-limited APIs or create a burst of child processes.
- **Recommendation**: Use PQueue with concurrency 5–10, consistent with the rest of the codebase.

### Positive Patterns

1. **Zero circular dependencies** — Rare for a 15K-LOC project. The layer discipline is excellent.
2. **Decomposed run command** — The 1,692-line monolith was split into 8 focused modules with clear contracts. Well done.
3. **Typed event bus** — `OacEventBus` with typed events prevents event name typos and provides IDE autocomplete.
4. **Zod config validation** — Comprehensive schema with strict mode, env var interpolation, and good error messages.
5. **Atomic file writes** — `atomicWriteJson` (write-to-tmp → rename) prevents partial writes on crash.
6. **`OacError` taxonomy** — Domain-specific error codes with severity levels enable proper retry/abort decisions.
7. **Memory pressure monitoring** — `createMemoryMonitor` with PQueue throttling is a sophisticated pattern for a CLI tool.

### Recommendations (prioritized)

1. **Extract AsyncEventQueue to shared module** — 90 lines × 2 = immediate win, blocks OpenCode adapter
2. **Unify error normalization** — Prevents inconsistent retry behavior, ~50 lines to extract
3. **Create scanner factory** — Deduplicate scanner construction, prepare for custom scanner plugin system
4. **Add agent registry** — Simple Map-based registry, enables OpenCode without touching existing code
5. **Bound estimateTaskMap with PQueue** — 5-line change for consistency

