# Task: Add oac log, oac leaderboard, oac status CLI Commands

## Goal
Add three new CLI subcommands to `packages/cli/`:
1. `oac log` — View contribution history
2. `oac leaderboard` — Show contribution rankings
3. `oac status` — Show current job status

## Architecture

Follow the exact same patterns as the existing commands in `packages/cli/src/commands/` (doctor.ts, scan.ts, etc.):
- Each command exports a `create{Name}Command()` function that returns a `Command`
- Commands use the Commander.js API
- Register new commands in `packages/cli/src/cli.ts` by importing and calling `program.addCommand(...)`

## Command 1: oac log (src/commands/log.ts)

```typescript
export function createLogCommand(): Command
```

Options:
- `--limit <number>` — Max entries to show (default: 20)
- `--repo <name>` — Filter by repo name
- `--source <type>` — Filter by task source (todo, lint, test-gap, etc.)
- `--since <date>` — Filter contributions after date (ISO string)

Logic:
1. Read `.oac/contributions/*.json` files from current directory
2. Parse each as `ContributionLog` (import from `@oac/tracking`)
3. Apply filters (repo, source, since, limit)
4. Sort by timestamp descending (newest first)
5. Output as table or JSON (if `--json` flag from global options)

Table columns: Date | Repo | Tasks | Tokens | PRs | Source

## Command 2: oac leaderboard (src/commands/leaderboard.ts)

```typescript
export function createLeaderboardCommand(): Command
```

Options:
- `--limit <number>` — Max entries (default: 10)
- `--sort <field>` — Sort by: runs, tasks, tokens, prs (default: tasks)

Logic:
1. Read `.oac/leaderboard.json` if it exists
2. If not, compute from `.oac/contributions/*.json` files
3. Sort entries by the selected field
4. Output as table or JSON

Table columns: Rank | User | Tasks | Tokens Used | PRs Created | PRs Merged

## Command 3: oac status (src/commands/status.ts)

```typescript
export function createStatusCommand(): Command
```

Options:
- `--watch` — Poll every 2 seconds (simple setInterval + console.clear)

Logic:
1. Read `.oac/status.json` (a simple file with current run state)
2. Show: current run ID, start time, agent, tasks in progress, completed tasks, errors
3. If no status file, show "No active runs"
4. If `--watch`, re-read and re-render every 2 seconds

Status file schema:
```typescript
interface RunStatus {
  runId: string;
  startedAt: string;
  agent: string;
  tasks: Array<{
    taskId: string;
    title: string;
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
}
```

## Register Commands

In `packages/cli/src/cli.ts`, add:
```typescript
import { createLogCommand } from "./commands/log.js";
import { createLeaderboardCommand } from "./commands/leaderboard.js";
import { createStatusCommand } from "./commands/status.js";

// Inside registerCommands():
program.addCommand(createLogCommand());
program.addCommand(createLeaderboardCommand());
program.addCommand(createStatusCommand());
```

## Tests

Create `packages/cli/tests/log.test.ts`, `packages/cli/tests/leaderboard.test.ts`, and `packages/cli/tests/status.test.ts`.

Each should have at least 5 test cases:
- Command is registered correctly
- Handles empty/missing data directory
- Parses and displays entries correctly
- Respects --limit option
- Respects filter options

Test approach: Use `vi.mock("node:fs/promises")` to mock file reads. Test the command creation via `createLogCommand().parse(["node", "test", ...options])`.

## Dependencies
- Already have `commander`, `chalk`, `ora`, `cli-table3` available
- Import `ContributionLog` and `contributionLogSchema` from `@oac/tracking`
- Use `@oac/core` for config types

## Code Style
- Use double quotes for strings
- Use `node:` prefix for Node.js imports
- Use `type` keyword for type-only imports
- camelCase for variables, PascalCase for classes
- No `any` type usage
