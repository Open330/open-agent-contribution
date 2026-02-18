# Task: Implement Test-Gap Scanner

## Goal
Create a new scanner in `packages/discovery/src/scanners/test-gap-scanner.ts` that identifies source files lacking test coverage.

## Architecture

Follow the exact same patterns as `todo-scanner.ts` and `lint-scanner.ts`:
- Implement the `Scanner` interface from `../types.js`
- Export a `TestGapScanner` class
- Use `@oac/core` types: `Task`, `TaskComplexity`, `TaskSource`

## Scanner Interface
```typescript
import type { Task, TaskComplexity, TaskSource } from "@oac/core";
import type { ScanOptions, Scanner } from "../types.js";

export class TestGapScanner implements Scanner {
  id: TaskSource | string = "test-gap";
  name = "Test Gap Scanner";
  async scan(repoPath: string, options?: ScanOptions): Promise<Task[]> { ... }
}
```

## Logic
1. Walk the `src/` directories to find all `.ts` files (excluding `.d.ts`, `index.ts`)
2. Walk the `tests/` and `__tests__/` directories to find all `.test.ts` files
3. For each source file, check if a corresponding test file exists
4. Generate a Task for each untested file with:
   - `id`: deterministic hash of file path
   - `title`: `"Add tests for ${filename}"`
   - `source`: `"test-gap"` (use `as TaskSource`)
   - `filePath`: the source file path
   - `complexity`: based on file size (small <50 lines, medium <200, large >=200)
   - `estimatedTokens`: rough estimate based on complexity
   - `description`: include the function/class names found in the file

5. Use `node:fs/promises` for all file operations (readdir, readFile, stat)
6. Use `node:path` for path resolution
7. Respect `options.exclude` patterns and `options.maxTasks` cap
8. Do NOT use any external dependencies beyond what's already in package.json

## Task Type Reference (from @oac/core)
```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  source: TaskSource;
  filePath?: string;
  line?: number;
  complexity: TaskComplexity;
  estimatedTokens: number;
  priority?: number;
  metadata?: Record<string, unknown>;
}
// TaskComplexity = "trivial" | "small" | "medium" | "large" | "epic"
// TaskSource = "todo" | "lint" | "test-gap" | "dead-code" | "github-issue" | "manual"
```

## Also Do
1. Export the scanner from `packages/discovery/src/index.ts` - add: `export * from "./scanners/test-gap-scanner.js";`
2. Create tests in `packages/discovery/tests/test-gap-scanner.test.ts` with at least 10 test cases:
   - Finds files without tests
   - Skips index.ts and .d.ts files
   - Respects exclude patterns
   - Handles empty repos
   - Respects maxTasks cap
   - Correct complexity assignment based on file size
   - Deterministic task IDs

## Code Style
- Use double quotes for strings
- Use `node:` prefix for Node.js imports
- Use `type` keyword for type-only imports
- Use camelCase for variables, PascalCase for classes
- No `any` type usage
