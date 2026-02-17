# @open330/oac-core

Core module for [OAC (Open Agent Contribution)](https://github.com/Open330/open-agent-contribution) — event bus, config loader, shared types, and error definitions.

## Install

```bash
npm install @open330/oac-core
```

## What's Inside

- **Event Bus** — typed EventEmitter for pipeline coordination
- **Config Loader** — Zod-validated `oac.config.ts` reader with `defineConfig()` helper
- **Types** — shared interfaces (`Task`, `TokenEstimate`, `ResolvedRepo`, etc.)
- **Errors** — `OacError` base class with error codes

## Usage

```typescript
import { createEventBus, loadConfig, OacError } from '@open330/oac-core';
```

## License

MIT — see the [main repo](https://github.com/Open330/open-agent-contribution) for details.
