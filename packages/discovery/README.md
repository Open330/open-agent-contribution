# @open330/oac-discovery

Task discovery scanners for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-discovery
```

## What's Inside

- **TodoScanner** — finds `TODO`/`FIXME`/`HACK` comments via ripgrep
- **LintScanner** — detects lint warnings from ESLint/Biome output
- **GitHubIssuesScanner** — fetches open issues labeled `good-first-issue`, `help-wanted`, etc.
- **CompositeScanner** — runs multiple scanners and merges results
- **Priority Ranker** — scores and sorts tasks by actionability

## Usage

```typescript
import { CompositeScanner, TodoScanner, LintScanner, rankTasks } from '@open330/oac-discovery';

const scanner = new CompositeScanner([new TodoScanner(), new LintScanner()]);
const tasks = await scanner.scan('/path/to/repo');
const ranked = rankTasks(tasks);
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
