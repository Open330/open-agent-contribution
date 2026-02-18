# Task: Remove Silent Simulation Fallback (P0-1)

## Overview
When no agent CLI (Claude Code / Codex) is available, OAC silently falls back to simulated execution with fake delays and fake results. This is the single worst UX decision — users think tasks ran when nothing happened. Fix: fail fast with actionable error.

## File: `src/cli/commands/run.ts`

### What to change:

#### 1. Update `resolveAdapter` function (~line 1031-1053)

After checking availability, if the adapter is NOT available, **throw an error** instead of returning `{ adapter: null, useRealExecution: false }`:

```typescript
async function resolveAdapter(
  providerId: string,
): Promise<{ adapter: AgentProvider; useRealExecution: true }> {
  const normalizedId = providerId === "codex-cli" ? "codex" : providerId;

  const adapters: Record<string, () => AgentProvider> = {
    codex: () => new CodexAdapter(),
    "claude-code": () => new ClaudeCodeAdapter(),
  };

  const factory = adapters[normalizedId];
  if (!factory) {
    throw new Error(
      `Unknown provider "${providerId}". Supported providers: codex, claude-code.\n` +
      `Run \`oac doctor\` to check your environment setup.`
    );
  }

  const adapter = factory();
  const availability = await adapter.checkAvailability();
  if (!availability.available) {
    throw new Error(
      `Agent CLI "${normalizedId}" is not available: ${availability.reason ?? "unknown reason"}.\n` +
      `Install the ${normalizedId} CLI or switch providers.\n` +
      `Run \`oac doctor\` for setup instructions.`
    );
  }

  return { adapter, useRealExecution: true };
}
```

#### 2. Remove the `simulateExecution` function entirely

Delete the `simulateExecution` function (and the `sleep` helper if it's only used by simulation).

#### 3. Update both call sites

In `executeEpicEntry` (~line 400) and `executePlan` (~line 787), remove the simulation branch:

**Before:**
```typescript
if (useRealExecution && adapter) {
  const result = await executeWithAgent({ ... });
  execution = result.execution;
  sandbox = result.sandbox;
} else {
  execution = await simulateExecution(task, estimate);
}
```

**After:**
```typescript
const result = await executeWithAgent({
  task,
  estimate,
  adapter,
  repoPath: resolvedRepo.localPath,
  baseBranch: resolvedRepo.meta.defaultBranch,
  timeoutSeconds,
});
execution = result.execution;
sandbox = result.sandbox;
```

#### 4. Keep `--dry-run` flag working

If there's a `--dry-run` flag that uses simulation for preview, keep that functionality but make it explicit. Only remove the SILENT fallback. If `--dry-run` exists, its simulation path should print a clear message like "DRY RUN — no real execution".

## Verification
- Run `pnpm build` to ensure no type errors
- Grep for `simulateExecution` to ensure all references are removed
- Verify `--dry-run` still works if it exists

## MUST NOT
- Change the execution engine or agent adapters
- Remove `--dry-run` functionality if it exists
- Modify files outside `run.ts`
- Change how real execution works

