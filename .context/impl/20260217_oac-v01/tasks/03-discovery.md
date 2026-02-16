# Task: Implement packages/discovery

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` section 6 for architecture.

## Deliverables

Implement in `packages/discovery/src/`:

### 1. `types.ts` — Discovery Types
- Import `Task`, `TaskSource`, `TaskComplexity` from @oac/core
- `Scanner` interface: id, name, scan(repoPath, options) => Promise<Task[]>
- `ScanOptions`: exclude patterns, timeout, etc.
- `PriorityWeights` interface

### 2. `scanners/todo-scanner.ts` — TODO Scanner
- Scan for TODO, FIXME, HACK, XXX patterns using ripgrep (via execa or built-in)
- Parse surrounding context (file, line number, function name)
- Group TODOs within 10 lines of each other
- Map to Task with complexity: single-line = trivial, multi-line = simple

### 3. `scanners/lint-scanner.ts` — Lint Scanner
- Detect project linter (eslint, biome, etc.) from package.json
- Run the linter in JSON output mode
- Parse results into Task objects
- Auto-fixable = trivial, multiple rules = simple

### 4. `scanner.ts` — Composite Scanner
- `CompositeScanner` class that runs multiple scanners in parallel
- Collects all tasks, deduplicates by content hash
- Returns combined task list

### 5. `ranker.ts` — Priority Ranker
- Score each task 0-100 based on: impact (0-25), feasibility (0-25), freshness (0-15), issueSignals (0-15), tokenEfficiency (0-20)
- Sort tasks by priority descending
- Export `rankTasks(tasks: Task[]): Task[]`

### 6. `index.ts` — Re-export

## Dependencies
- @oac/core (workspace:*)
- @oac/repo (workspace:*) — for ResolvedRepo type
