# Task: CLI UX Quick Fixes (P0-2, P0-3, T2-4)

## Overview
Three independent CLI improvements: proper TypeScript config generation, Getting Started help text, and SIGINT handler for watch mode.

## Task 1: Fix `oac init` config generation (P0-2)

**File**: `src/cli/commands/init.ts`

**Current code** — the `buildConfigFile` function generates plain JS in a `.ts` file:
```typescript
function buildConfigFile(input: { ... }): string {
  return `export default {
  repos: ['${input.repo}'],
  provider: { ... },
  budget: { ... },
};
`;
}
```

**Fix**: Update to generate proper TypeScript with `defineConfig` import:
```typescript
function buildConfigFile(input: { ... }): string {
  const enabledProviders = input.providers.map((provider) => `"${provider}"`).join(", ");

  return `import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: ["${input.repo}"],
  provider: {
    id: "${input.provider}",
    options: {
      enabledProviders: [${enabledProviders}],
    },
  },
  budget: {
    totalTokens: ${input.budgetTokens},
  },
});
`;
}
```

Key changes:
- Add `import { defineConfig } from "@open330/oac"` at top
- Wrap config object in `defineConfig()` call
- Use double quotes for consistency with TypeScript conventions

## Task 2: Add "Getting Started" to root help (P0-3)

**File**: `src/cli/cli.ts`

Find the `createCliProgram()` function (or wherever the Commander program is created). After setting up the program description, add help text:

```typescript
program.addHelpText('after', `
Getting Started:
  $ oac init          Set up your project configuration
  $ oac doctor        Verify your environment is ready
  $ oac run           Run the full contribution pipeline

Documentation: https://github.com/open330/oac
`);
```

## Task 3: Add SIGINT handler to status watch mode (T2-4)

**File**: `src/cli/commands/status.ts`

**Current code** — `setInterval` without cleanup:
```typescript
setInterval(() => {
  console.clear();
  void render().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}, WATCH_INTERVAL_MS);
```

**Fix**: Store the interval ID and add SIGINT handler:
```typescript
const intervalId = setInterval(() => {
  console.clear();
  void render().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}, WATCH_INTERVAL_MS);

process.on("SIGINT", () => {
  clearInterval(intervalId);
  console.log("\nWatch mode stopped.");
  process.exit(0);
});
```

## Verification
- Run `pnpm build` to ensure no type errors
- Verify `defineConfig` is exported from the package entry point

## MUST NOT
- Change command behavior or flag signatures
- Modify files outside the 3 specified files
- Add new dependencies

