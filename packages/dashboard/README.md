# @open330/oac-dashboard

Web dashboard for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution).

## Install

```bash
npm install @open330/oac-dashboard
```

## What's Inside

- **Fastify Server** — localhost web dashboard for managing OAC runs
- **SSE Streaming** — real-time progress updates via Server-Sent Events
- **Embedded SPA** — dark-mode UI with task filters, budget controls, and contribution history

## Usage

```bash
# Via CLI
oac dashboard

# Programmatic
```

```typescript
import { startDashboard } from '@open330/oac-dashboard';

await startDashboard({ port: 3330 });
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
