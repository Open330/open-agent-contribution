# @open330/oac-repo

Repository resolution and cloning for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-repo
```

## What's Inside

- **Repo Resolver** — parse `owner/repo`, GitHub URLs, or SSH URIs into a structured `ResolvedRepo`
- **Clone Manager** — shallow clone with `simple-git`, automatic cache at `~/.oac/cache/repos/`
- **Metadata Cache** — JSON-based cache for repo metadata (languages, permissions, head SHA)

## Usage

```typescript
import { resolveRepo, cloneRepo } from '@open330/oac-repo';

const repo = await resolveRepo('facebook/react');
await cloneRepo(repo);
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
