# @open330/oac-completion

PR creation and issue linking for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-completion
```

## What's Inside

- **PR Handler** — creates pull requests via Octokit with structured descriptions
- **Issue Linker** — links PRs to source issues/TODOs with `Closes #N` references
- **Diff Validator** — sanity-checks agent output before submitting

## Usage

```typescript
import { createCompletionHandler } from '@open330/oac-completion';

const handler = createCompletionHandler({ token: process.env.GITHUB_TOKEN });
const pr = await handler.createPR({ repo, task, execution });
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
