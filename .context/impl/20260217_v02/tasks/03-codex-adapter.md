# Task: Implement Codex CLI Agent Adapter

## Goal
Create a new agent adapter in `packages/execution/src/agents/codex.adapter.ts` that runs tasks using the Codex CLI (`codex exec`).

## Architecture

Follow the exact same patterns as `claude-code.adapter.ts`:
- Implement the `AgentProvider` interface from `./agent.interface.js`
- Export a `CodexAdapter` class
- Use the same `AsyncEventQueue` pattern for streaming events
- Use `execa` for process management

## AgentProvider Interface (already defined)
```typescript
interface AgentProvider {
  readonly id: AgentProviderId;  // "codex"
  readonly name: string;         // "Codex CLI"
  checkAvailability(): Promise<AgentAvailability>;
  execute(params: AgentExecuteParams): AgentExecution;
  estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;
  abort(executionId: string): Promise<void>;
}
```

## Implementation Details

### checkAvailability()
- Run `codex --version` using execa
- Parse version string
- Return `{ available: true, version: "x.y.z" }` on success
- Return `{ available: false, error: "..." }` on failure

### execute(params)
- Build the codex command: `codex exec --full-auto`
- Pass the prompt from `params.prompt`
- Set `cwd` to `params.workingDirectory`
- Set environment: `{ ...process.env, ...params.env }`
- Use `-C` flag for working directory
- Handle stdout/stderr streaming via `AsyncEventQueue<AgentEvent>`
- Parse JSON lines from stdout for structured events if available
- Set up timeout handling with `params.timeoutMs`
- Track running processes for abort support

### estimateTokens(params)
- Use a simple heuristic:
  - Base: 2000 tokens per file
  - Prompt tokens: estimate from prompt length (1 token ≈ 4 chars)
  - Context: sum of file sizes / 4
- Return `TokenEstimate` with `feasible: true` if total < 200000

### abort(executionId)
- Find running process by executionId
- Kill with SIGTERM, then SIGKILL after 2s timeout

## Copy the AsyncEventQueue class from claude-code.adapter.ts
The `AsyncEventQueue<T>` class is defined inside claude-code.adapter.ts. Copy it to a shared location OR duplicate it in the codex adapter (simpler for now — just copy the class into codex.adapter.ts).

## Also Do
1. Export from `packages/execution/src/index.ts` — add: `export * from "./agents/codex.adapter.js";`
2. Create tests in `packages/execution/tests/codex-adapter.test.ts` with at least 10 test cases:
   - checkAvailability returns version when codex is installed
   - checkAvailability returns unavailable when codex not found
   - execute spawns codex process with correct args
   - execute streams stdout events
   - execute handles process exit
   - execute handles timeout
   - abort kills running process
   - estimateTokens returns feasible for small tasks
   - estimateTokens returns infeasible for huge tasks
   - Mock execa for all tests (vi.mock("execa"))

## Dependencies
- Already have `execa` in package.json
- Use `@oac/core` for types (OacError, executionError, TokenEstimate, AgentProviderId)

## Code Style
- Use double quotes for strings
- Use `node:` prefix for Node.js imports
- Use `type` keyword for type-only imports
- camelCase for variables, PascalCase for classes
- No `any` type usage
