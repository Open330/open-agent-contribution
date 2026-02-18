# Task: Implement GitHub Issues Scanner

## Goal
Create a new scanner in `packages/discovery/src/scanners/github-issues-scanner.ts` that fetches open GitHub issues and converts them to OAC tasks.

## Architecture

Follow the same patterns as `todo-scanner.ts` and `lint-scanner.ts`:
- Implement the `Scanner` interface from `../types.js`
- Export a `GitHubIssuesScanner` class
- Use `@oac/core` types: `Task`, `TaskComplexity`, `TaskSource`
- The `ScanOptions.repo` field provides `ResolvedRepo` with `owner` and `name`

## Scanner Interface
```typescript
import type { Task, TaskComplexity, TaskSource } from "@oac/core";
import type { ScanOptions, Scanner } from "../types.js";

export class GitHubIssuesScanner implements Scanner {
  id: TaskSource | string = "github-issue";
  name = "GitHub Issues Scanner";

  constructor(private readonly token?: string) {
    // token from GITHUB_TOKEN env or constructor arg
  }

  async scan(repoPath: string, options?: ScanOptions): Promise<Task[]> { ... }
}
```

## Logic
1. Get GitHub token from constructor arg or `process.env.GITHUB_TOKEN`
2. If no token available, return empty array (no error)
3. Use the repo info from `options?.repo` (has `owner` and `name` fields)
4. If no repo info, try to parse from `.git/config` remote URL
5. Fetch open issues using GitHub REST API (NOT using @octokit — use native `fetch()`)
   - `GET https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=30&sort=updated`
   - Set `Authorization: Bearer ${token}` header
   - Set `Accept: application/vnd.github.v3+json` header
6. Filter out pull requests (issues with `pull_request` field)
7. Convert each issue to a Task:
   - `id`: `github-issue-${issue.number}`
   - `title`: issue title (truncated to 120 chars)
   - `description`: issue body (truncated to 500 chars) + labels
   - `source`: `"github-issue"` as TaskSource
   - `complexity`: based on labels (bug=small, feature=large, enhancement=medium, default=medium)
   - `estimatedTokens`: based on complexity
   - `metadata`: `{ issueNumber, labels, url, author, createdAt }`

8. Respect `options.maxTasks` cap
9. Handle API errors gracefully (rate limit, 404, network error) — return empty array on failure

## Also Do
1. Export the scanner from `packages/discovery/src/index.ts` — add: `export * from "./scanners/github-issues-scanner.js";`
2. Create tests in `packages/discovery/tests/github-issues-scanner.test.ts` with at least 10 test cases:
   - Returns empty when no token
   - Returns empty when no repo info
   - Parses issues correctly
   - Filters out pull requests
   - Respects maxTasks
   - Maps labels to complexity
   - Handles API errors gracefully
   - Truncates long titles/descriptions
   - Sets correct metadata
   - Mock fetch for all tests (use vi.fn())

## Dependencies
- Do NOT add any new dependencies — use native `fetch()` (Node 22+ has it built in)
- Do NOT import @octokit/rest

## Code Style
- Use double quotes for strings
- Use `node:` prefix for Node.js imports
- Use `type` keyword for type-only imports
- camelCase for variables, PascalCase for classes
- No `any` type — use proper interfaces for API responses
