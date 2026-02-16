# Task: Implement packages/tracking

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` section 10 for architecture.

## Deliverables

Implement in `packages/tracking/src/`:

### 1. `log-schema.ts` — Contribution Log Schema
- Zod schema for `ContributionLog` with version '1.0'
- Includes: runId, timestamp, contributor (githubUsername, email?), repo (fullName, headSha, defaultBranch), budget (provider, totalTokensBudgeted, totalTokensUsed, estimatedCostUsd?), tasks array (ContributionTask[]), metrics
- `ContributionTask` schema: taskId, title, source, complexity, status, tokensUsed, duration, filesChanged, pr?, linkedIssue?, error?

### 2. `logger.ts` — Contribution Logger
- `writeContributionLog(log: ContributionLog, repoPath: string): Promise<string>`
- Write to `{repoPath}/.oac/contributions/YYYY-MM-DD-HHmmss-{username}.json`
- Atomic write (write to temp, rename)
- Create .oac/contributions/ directory if not exists

### 3. `leaderboard.ts` — Leaderboard Aggregator
- `buildLeaderboard(repoPath: string): Promise<Leaderboard>`
- Scan all files in .oac/contributions/
- Aggregate by username: totalRuns, totalTasksCompleted, totalTokensDonated, etc.
- Cache result in .oac/leaderboard.json
- `LeaderboardEntry` interface

### 4. `index.ts` — Re-export

## Dependencies
- @oac/core (workspace:*)
- zod ^3.24.2
