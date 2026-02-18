# OAC Multi-Agent Support Technical Specification

## 1. Objective
Add production-grade multi-agent execution to OAC with these outcomes:
1. Claude Code adapter runs real `claude` CLI subprocesses (non-interactive, stream parsing, abort support).
2. OpenCode adapter is added and runs real `opencode` CLI subprocesses.
3. Tasks are routed by complexity:
   - `trivial`, `simple` -> `codex`
   - `moderate`, `complex` -> `claude-code`
4. `oac run --provider` accepts comma-separated providers (example: `codex,claude-code`).
5. Agent health checks and automatic fallback retries are applied when an agent fails.

## 2. Current State Summary
1. `CodexAdapter` is implemented and functional in `packages/execution/src/agents/codex.adapter.ts`.
2. `ClaudeCodeAdapter` exists but is not integrated into `oac run` execution path.
3. `ExecutionEngine` currently round-robins agents and has no routing-by-complexity or provider health state.
4. `oac run` currently executes only Codex (or simulated execution) and accepts a single `--provider` string.
5. Provider IDs are inconsistent (`codex` vs `codex-cli`) across packages.

## 3. Design Decisions
1. Canonical runtime provider IDs for execution will be:
   - `codex`
   - `claude-code`
   - `opencode`
2. Legacy alias `codex-cli` will remain accepted at CLI/config boundaries and normalized to `codex`.
3. Routing happens per task, using complexity-first preference and user-selected provider availability.
4. Fallback is provider-level: if provider A fails, retry task on provider B before final failure.
5. Health checking is run-level with lightweight in-memory state, not persisted.

## 4. External CLI Contracts

### 4.1 Claude Code subprocess contract
Use:
```bash
claude -p "<prompt>" --output-format stream-json --verbose
```
Process options:
- `cwd = params.workingDirectory`
- `env` includes inherited env + `params.env` + `OAC_TOKEN_BUDGET` + `OAC_ALLOW_COMMITS`
- `timeout = params.timeoutMs`

Parsing:
- Parse stream JSON lines when available.
- Emit `output`, `tokens`, `file_edit`, `tool_use`, and `error` events.
- Fall back to regex parsing for plain-text lines.

### 4.2 OpenCode subprocess contract
Use:
```bash
opencode run --format json "<prompt>"
```
Process options:
- `cwd = params.workingDirectory`
- `env` includes inherited env + `params.env` + `OAC_TOKEN_BUDGET` + `OAC_ALLOW_COMMITS`
- `timeout = params.timeoutMs`

Parsing:
- Primary: JSON event lines from `--format json`.
- Fallback: plain text line heuristics for token/file/error events.

## 5. File-by-File Changes

### 5.1 `packages/core/src/types.ts`
1. Update provider type for canonical + compatibility:
```ts
export type AgentProviderId =
  | "claude-code"
  | "codex"
  | "codex-cli"
  | "opencode"
  | (string & {});
```
2. No runtime behavior change in core.

### 5.2 `packages/execution/src/agents/claude-code.adapter.ts`
1. Keep `id = "claude-code"`.
2. Ensure `execute()` uses `claude` CLI subprocess and structured output flags.
3. Keep error normalization pattern aligned with Codex adapter:
   - timeout -> `AGENT_TIMEOUT`
   - OOM -> `AGENT_OOM`
   - network -> `NETWORK_ERROR`
   - default -> `AGENT_EXECUTION_FAILED`
4. Keep `checkAvailability()` as `claude --version` with non-throwing availability object.
5. Keep `abort()` SIGTERM then SIGKILL escalation with timer.

### 5.3 `packages/execution/src/agents/opencode.adapter.ts` (new)
1. Add new class implementing `AgentProvider`:
```ts
export class OpenCodeAdapter implements AgentProvider {
  public readonly id: AgentProviderId = "opencode";
  public readonly name = "OpenCode CLI";

  public async checkAvailability(): Promise<AgentAvailability>;
  public execute(params: AgentExecuteParams): AgentExecution;
  public async estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;
  public async abort(executionId: string): Promise<void>;
}
```
2. Implementation mirrors Codex/Claude adapter behavior:
   - subprocess lifecycle map (`runningExecutions`)
   - async event queue streaming
   - structured + heuristic parsing
   - normalized `AgentResult`
3. `checkAvailability()` command: `opencode --version`.
4. `execute()` command: `opencode run --format json <prompt>`.

### 5.4 `packages/execution/src/index.ts`
1. Export new adapter:
```ts
export * from "./agents/opencode.adapter.js";
```

### 5.5 `packages/execution/src/engine.ts`
Add routing + health + fallback behavior.

#### 5.5.1 Type updates
1. Extend `Job`:
```ts
attemptedProviders: AgentProviderId[];
preferredProviders: AgentProviderId[];
```
2. Add internal health state:
```ts
interface ProviderHealthState {
  providerId: AgentProviderId;
  available: boolean;
  version?: string;
  lastError?: string;
  consecutiveFailures: number;
  checkedAt: number;
}
```

#### 5.5.2 New private members
```ts
private readonly providerById: Map<AgentProviderId, AgentProvider>;
private readonly providerHealth: Map<AgentProviderId, ProviderHealthState>;
```

#### 5.5.3 New private methods
```ts
private async initializeProviderHealth(): Promise<void>;
private computePreferredProviders(task: Task): AgentProviderId[];
private selectAgentForJob(job: Job): AgentProvider;
private recordProviderSuccess(providerId: AgentProviderId): void;
private recordProviderFailure(providerId: AgentProviderId, error: OacError): void;
private canFallback(job: Job): boolean;
private scheduleFallback(job: Job): boolean;
```

#### 5.5.4 Routing logic
1. `computePreferredProviders(task)` returns ordered list:
   - `trivial/simple`: `["codex", "claude-code", "opencode"]`
   - `moderate/complex`: `["claude-code", "codex", "opencode"]`
2. Order is filtered by providers passed into engine constructor and current health.
3. On each job attempt, `selectAgentForJob(job)` picks first provider not already in `job.attemptedProviders`.

#### 5.5.5 Fallback logic
1. If execution fails and any untried healthy provider remains, schedule immediate retry on fallback provider.
2. If no untried provider remains, apply existing transient retry rules.
3. Mark provider health failures on:
   - `AGENT_TIMEOUT`
   - `AGENT_OOM`
   - `AGENT_RATE_LIMITED`
   - `NETWORK_ERROR`
   - `AGENT_EXECUTION_FAILED`
4. Reset consecutive failures after a successful task on that provider.

### 5.6 `packages/cli/src/commands/run.ts`

#### 5.6.1 Option parsing
1. Keep flag name, change semantics:
```ts
.option("--provider <ids>", "Comma-separated provider ids (e.g. codex,claude-code)")
```
2. Replace single-provider resolver:
```ts
function resolveProviderIds(providerOption: string | undefined, config: OacConfig | null): AgentProviderId[];
function parseProviderIds(input: string): AgentProviderId[];
function normalizeProviderId(input: string): AgentProviderId;
```
3. Supported user inputs:
   - `codex`, `codex-cli` -> `codex`
   - `claude-code`
   - `opencode`
4. Deduplicate providers while preserving order.
5. Validation errors are user-facing, fail fast.

#### 5.6.2 Adapter bootstrap
1. Add provider factory:
```ts
function createRequestedAdapters(providerIds: AgentProviderId[]): AgentProvider[];
```
2. Instantiate only requested adapters.
3. Run `checkAvailability()` for all requested providers at start.

#### 5.6.3 Health-aware execution setup
1. Build `healthyProviders` list from availability checks.
2. Fail run if none are healthy.
3. If subset healthy, continue and print warning listing disabled providers.

#### 5.6.4 Routing during execution stage
1. Replace Codex-only path with provider-routed path:
```ts
async function executeWithRouting(input: {
  task: Task;
  estimate: TokenEstimate;
  providerIds: AgentProviderId[];
  adapters: Map<AgentProviderId, AgentProvider>;
  repoPath: string;
  baseBranch: string;
  timeoutSeconds: number;
}): Promise<{ execution: ExecutionOutcome; sandbox: SandboxInfo }>;
```
2. `executeWithRouting()` chooses preferred provider by task complexity and fallbacks if needed.
3. Preserve existing sandbox + commit + PR flow.

#### 5.6.5 Token estimation changes
1. Replace `estimateTaskMap(tasks, providerId)` with provider-aware selection:
```ts
async function estimateTaskMap(
  tasks: Task[],
  providerSelector: (task: Task) => AgentProviderId,
): Promise<Map<string, TokenEstimate>>;
```
2. For each task, estimate using preferred provider selected by complexity and provider availability.

#### 5.6.6 CLI UX changes
1. Startup output includes:
   - requested providers
   - availability status per provider
   - routing policy summary
2. Per-task verbose output includes selected provider.
3. On fallback, log one-line message:
   - `Task <id>: <failed-provider> failed (<code>), retrying with <fallback-provider>`
4. Summary output changes:
   - `provider` -> comma-joined provider list for text mode
   - JSON summary adds `providers: string[]`

### 5.7 `packages/budget/src/estimator.ts`
1. Update local provider type alias to include `codex` and legacy alias.
2. Keep counter selection:
   - `claude-code` -> Claude counter
   - `codex`, `codex-cli`, `opencode` -> Codex counter (initially)

## 6. Error Handling Patterns

### 6.1 Adapter-level patterns
1. `checkAvailability()` never throws; returns `{ available: false, error }`.
2. `execute()` may reject with normalized `OacError` only.
3. Non-zero exit code without throw returns `success: false` result with extracted error text.
4. Timeouts map to `AGENT_TIMEOUT`.

### 6.2 Engine/CLI fallback patterns
1. Retry with alternate provider first when available.
2. Use backoff only when cycling retry attempts after fallback options are exhausted.
3. Fail final job with last normalized `OacError` and include context:
   - `attempt`
   - `providersTried`
   - `taskId`
   - `jobId`

### 6.3 Input validation errors (`oac run`)
1. Unknown provider ID -> throw with allowed values list.
2. Empty provider list after parsing -> throw.
3. Duplicate IDs are silently deduplicated.

## 7. Test Plan

### 7.1 New tests
1. `packages/execution/tests/claude-code-adapter.test.ts`
   - availability success/failure
   - subprocess args
   - stream parsing
   - timeout normalization
   - abort behavior
2. `packages/execution/tests/opencode-adapter.test.ts`
   - same coverage shape as Codex/Claude adapters

### 7.2 Engine tests update
File: `packages/execution/tests/engine.test.ts`
1. Routes trivial/simple tasks to Codex first.
2. Routes moderate/complex tasks to Claude first.
3. Falls back to alternate provider on provider failure.
4. Marks unavailable providers out of routing after failed health checks.

### 7.3 CLI tests
Add: `packages/cli/tests/run.test.ts`
1. Parses `--provider codex,claude-code` correctly.
2. Normalizes `codex-cli` to `codex`.
3. Rejects unknown providers.
4. Uses available provider when one is unhealthy.
5. Emits fallback message when first provider fails.

## 8. Migration and Compatibility
1. Backward compatibility:
   - `codex-cli` accepted and normalized to `codex`.
2. No breaking change to existing single-provider usage:
   - `--provider claude-code` still valid.
3. If config has `provider.id = "codex-cli"`, runtime behaves as `codex`.

## 9. Implementation Order
1. Add provider normalization and ID compatibility (`core`, `budget`, `cli`).
2. Implement `OpenCodeAdapter` and finalize Claude subprocess flags/parsing.
3. Add routing/fallback internals to `ExecutionEngine`.
4. Update `oac run` to multi-provider parse, health check, routing, and fallback.
5. Add tests and adjust README command examples.

## 10. Out of Scope
1. Dashboard multi-agent wiring (`packages/dashboard`) in this change set.
2. Persisted cross-run health state.
3. Cost-based dynamic routing (future enhancement).
