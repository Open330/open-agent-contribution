# @open330/oac-tracking

Contribution tracking and leaderboard for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-tracking
```

## What's Inside

- **Contribution Logger** — writes JSON audit logs to `.oac/contributions/`
- **Leaderboard** — aggregates contribution stats across team members
- **JSON Schema** — typed contribution log format

## Usage

```typescript
import { writeContributionLog } from '@open330/oac-tracking';

await writeContributionLog(repoPath, {
  contributor: 'jiun',
  tasks: completedTasks,
  tokensUsed: 42_000,
  prsCreated: 3,
});
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
