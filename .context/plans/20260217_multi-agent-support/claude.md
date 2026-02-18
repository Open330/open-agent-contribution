# Multi-Agent Support Architecture Plan

**Date:** 2026-02-17
**Author:** Claude (architectural plan)
**Status:** Draft

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Proposed Architecture Overview](#2-proposed-architecture-overview)
3. [Claude Code Adapter -- Full Implementation](#3-claude-code-adapter----full-implementation)
4. [OpenCode Adapter -- New](#4-opencode-adapter----new)
5. [Agent Registry](#5-agent-registry)
6. [Agent Router -- Complexity-Based Assignment](#6-agent-router----complexity-based-assignment)
7. [Execution Engine Changes](#7-execution-engine-changes)
8. [Worker Changes](#8-worker-changes)
9. [CLI Changes](#9-cli-changes)
10. [Config Schema Changes](#10-config-schema-changes)
11. [Dashboard Pipeline Changes](#11-dashboard-pipeline-changes)
12. [Dashboard UI Changes](#12-dashboard-ui-changes)
13. [Core Type Changes](#13-core-type-changes)
14. [Error Handling for Mixed-Agent Runs](#14-error-handling-for-mixed-agent-runs)
15. [New Files Summary](#15-new-files-summary)
16. [Modified Files Summary](#16-modified-files-summary)
17. [Migration Path](#17-migration-path)
18. [Testing Strategy](#18-testing-strategy)

---

## 1. Current Architecture Analysis

### 1.1 Agent Provider Interface

**File:** `packages/execution/src/agents/agent.interface.ts`

The `AgentProvider` interface is well-designed and already supports polymorphism:

```typescript
export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly name: string;
  checkAvailability(): Promise<AgentAvailability>;
  execute(params: AgentExecuteParams): AgentExecution;
  estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;
  abort(executionId: string): Promise<void>;
}
```

Key supporting types:
- `AgentAvailability` -- includes `available`, `version`, `error`, `remainingBudget`
- `AgentExecuteParams` -- execution context with `executionId`, `workingDirectory`, `prompt`, `targetFiles`, `tokenBudget`, `allowCommits`, `timeoutMs`, `env`
- `AgentEvent` -- union type covering `output`, `tokens`, `file_edit`, `tool_use`, `error`
- `AgentExecution` -- streaming execution handle with `events: AsyncIterable<AgentEvent>` and `result: Promise<AgentResult>`

**Assessment:** The interface is sufficient for multi-agent support. No breaking changes needed. We may want to add optional capability metadata (see section 6).

### 1.2 Codex Adapter (Working Reference)

**File:** `packages/execution/src/agents/codex.adapter.ts` (637 lines)

Fully functional adapter that:
- Spawns `codex exec --full-auto -C <dir> <prompt>` via `execa`
- Streams stdout/stderr line-by-line, parsing JSON payloads for token usage, file edits, tool use, and errors
- Uses an internal `AsyncEventQueue<T>` for backpressure-safe async iteration
- Tracks `TokenState` (input/output/cumulative) incrementally
- Handles timeout, cancellation, OOM, rate-limiting, and network errors
- Estimates tokens using file stat sizes (4 bytes per token heuristic)
- Manages running processes in a `Map<string, RunningProcess>` for abort support
- Uses SIGTERM with a 2-second SIGKILL fallback

### 1.3 Claude Code Adapter (Current State)

**File:** `packages/execution/src/agents/claude-code.adapter.ts` (633 lines)

Despite being described as a "stub," this is actually a **nearly complete implementation**. It:
- Spawns `claude -p <prompt>` with the working directory set via `cwd`
- Has its own `AsyncEventQueue`, JSON payload parsing, token tracking
- Parses both JSON and plaintext output for token events, file edits, tool use, errors
- Has slightly different parsing logic from Codex (e.g., `parseFileEditFromLine` for plaintext patterns like "created file.ts")
- Handles the same error classes (timeout, OOM, network, rate-limit)
- Uses a 5-second SIGKILL timeout (vs 2s for Codex)

**What is missing / needs improvement:**
1. Does not use `--output-format json` or `--verbose` flags for structured output
2. Does not pass `--max-turns` or `--allowedTools` for scoped execution
3. Does not leverage the Claude Code SDK (`@anthropic-ai/claude-code`) for programmatic control
4. Token estimation is basic -- uses `prompt.length / 4` without file stat sizes
5. No `--dangerously-skip-permissions` flag for fully automated mode
6. The `id` is `"claude-code"` but `AgentProviderId` also defines `"codex-cli"` -- the Codex adapter uses `"codex"` instead of `"codex-cli"` (minor inconsistency)

### 1.4 Execution Engine

**File:** `packages/execution/src/engine.ts` (439 lines)

The engine already supports multiple agents:

```typescript
constructor(
  private readonly agents: AgentProvider[],
  ...
)
```

Agent selection uses simple round-robin:

```typescript
private selectAgent(): AgentProvider {
  const agent = this.agents[this.nextAgentIndex % this.agents.length];
  this.nextAgentIndex = (this.nextAgentIndex + 1) % this.agents.length;
  return agent;
}
```

The engine manages a `PQueue` with priority scheduling, retry logic with exponential backoff for transient errors (timeout, OOM, rate-limit, network, git lock), and per-job sandbox creation with worktree isolation.

**Assessment:** The engine already has multi-agent plumbing. What it lacks is *intelligent* agent selection -- currently it just round-robins. The `selectAgent()` method is the primary integration point for the routing strategy.

### 1.5 Worker

**File:** `packages/execution/src/worker.ts` (177 lines)

The `executeTask()` function is agent-agnostic -- it takes an `AgentProvider`, builds a prompt, streams events, and merges results. No changes needed for multi-agent support.

### 1.6 CLI Run Command

**File:** `packages/cli/src/commands/run.ts` (1123 lines)

Key observations:
- `--provider <id>` accepts a single string
- `resolveProviderId()` returns a single string, defaulting to `"claude-code"`
- Only `CodexAdapter` is imported and instantiated
- Provider selection is checked with `providerId.includes("codex") && codexAvailability.available`
- No agent factory pattern -- hardcoded `new CodexAdapter()`
- The CLI does NOT use the `ExecutionEngine` class at all -- it has its own execution loop with `runWithConcurrency`

**Assessment:** This is the biggest gap. The CLI needs an agent factory/registry, support for multiple `--provider` flags, and ideally should delegate to the `ExecutionEngine` instead of reimplementing concurrency.

### 1.7 Dashboard Pipeline

**File:** `packages/dashboard/src/pipeline.ts` (591 lines)

Similar to the CLI:
- Hardcodes `new CodexAdapter()`
- Uses `config.provider.includes("codex") && codexAvailability.available` for selection
- Does not use the `ExecutionEngine`
- Has its own `executePipeline()` with similar structure

### 1.8 Core Types

**File:** `packages/core/src/types.ts`

`AgentProviderId` is already extensible:
```typescript
export type AgentProviderId = "claude-code" | "codex-cli" | "opencode" | (string & {});
```

`TaskComplexity` already supports the values we need for routing:
```typescript
export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex";
```

### 1.9 Config Schema

**File:** `packages/core/src/config.ts`

The provider config is currently singular:
```typescript
export const ProviderSchema = z.object({
  id: z.string().min(1).default("claude-code"),
  options: z.record(z.string(), z.unknown()).default({}),
}).strict().default({});
```

This needs to become an array or map structure to support multi-agent configuration.

---

## 2. Proposed Architecture Overview

```
                          +------------------+
                          |   CLI / Dashboard |
                          |  --provider flag  |
                          +--------+---------+
                                   |
                                   v
                          +------------------+
                          |  AgentRegistry   |
                          |  (singleton map) |
                          +--------+---------+
                                   |
                          +--------+---------+
                          |  AgentRouter     |
                          |  (strategy)      |
                          +--------+---------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
              v                    v                    v
     +----------------+  +------------------+  +----------------+
     | ClaudeCode     |  |  CodexAdapter    |  | OpenCode       |
     | Adapter        |  |                  |  | Adapter        |
     +----------------+  +------------------+  +----------------+
              |                    |                    |
              v                    v                    v
     +----------------+  +------------------+  +----------------+
     | claude CLI     |  |  codex CLI       |  | opencode CLI   |
     +----------------+  +------------------+  +----------------+
```

### Key Design Decisions

1. **AgentRegistry** -- a singleton registry that maps `AgentProviderId` to `AgentProvider` instances. Replaces hardcoded `new CodexAdapter()` everywhere.

2. **AgentRouter** -- a strategy object that, given a `Task` and a list of available agents, returns the best agent. The default strategy is complexity-based; users can override with `--provider` to force a specific agent.

3. **No breaking changes** -- single-provider configs continue to work. The `--provider` flag accepts a single value (backward compatible) or comma-separated values for multi-agent mode.

4. **Engine-first approach** -- the CLI and dashboard should delegate to `ExecutionEngine` instead of reimplementing execution loops. The engine already handles concurrency, retries, and agent selection.

---

## 3. Claude Code Adapter -- Full Implementation

### 3.1 File to Modify

`packages/execution/src/agents/claude-code.adapter.ts`

### 3.2 Changes

The existing implementation is mostly correct. The key improvements are:

#### A. Use `--output-format json` for structured output

Replace:
```typescript
const subprocess = execa("claude", ["-p", params.prompt], {
  cwd: params.workingDirectory,
  env: processEnv,
  reject: false,
  timeout: params.timeoutMs,
});
```

With:
```typescript
const args: string[] = [
  "-p", params.prompt,
  "--output-format", "json",
  "--verbose",
];

if (params.allowCommits) {
  args.push("--dangerously-skip-permissions");
}

const subprocess = execa("claude", args, {
  cwd: params.workingDirectory,
  env: processEnv,
  reject: false,
  timeout: params.timeoutMs,
});
```

**Rationale:** `--output-format json` gives us structured JSON output per conversation turn, making token/tool/file parsing far more reliable than regex-based line parsing.

#### B. Parse Claude Code JSON output format

Claude Code's JSON output includes structured messages:

```json
{
  "type": "result",
  "result": "...",
  "cost_usd": 0.05,
  "duration_ms": 12345,
  "num_turns": 3,
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 800
  }
}
```

Add a `parseClaudeJsonOutput()` function that handles this format directly instead of relying on the generic regex-based parsing.

#### C. Improve token estimation

Replace the naive estimation:
```typescript
const contextTokens =
  params.contextTokens ?? params.targetFiles.length * 80 + params.targetFiles.join("\n").length;
```

With file-stat-based estimation (matching what Codex does):
```typescript
const contextTokens = params.contextTokens ?? await estimateContextTokens(params.targetFiles);
```

Where `estimateContextTokens` reads file sizes and divides by 4 (matching the heuristic in `codex.adapter.ts`).

#### D. Fix provider ID consistency

Change `id` from `"claude-code"` to match the canonical `AgentProviderId`:
```typescript
public readonly id: AgentProviderId = "claude-code";  // already correct
```

This is actually already correct -- the `AgentProviderId` type includes `"claude-code"`.

#### E. Add `--max-turns` support

Add a configurable max-turns parameter to prevent runaway executions:
```typescript
if (maxTurns) {
  args.push("--max-turns", String(maxTurns));
}
```

This can be derived from the task complexity:
- `trivial`: 5 turns
- `simple`: 10 turns
- `moderate`: 20 turns
- `complex`: 50 turns

### 3.3 Shared Utilities Extraction

Both the Codex and Claude Code adapters duplicate significant code:
- `AsyncEventQueue<T>` (exact duplicate, ~70 lines each)
- `isRecord()`, `readString()`, `readNumber()` helpers
- `parseJsonPayload()`
- `normalizeFileAction()`, `parseFileEditFromPayload()`
- `normalizeExitCode()`, `hasBooleanFlag()`, `buildFailureMessage()`
- `computeTotalTokens()`, `estimateTokenCount()`

**New file:** `packages/execution/src/agents/shared.ts`

Extract all shared utilities into this module to eliminate duplication and ensure consistency across all adapters.

---

## 4. OpenCode Adapter -- New

### 4.1 New File

`packages/execution/src/agents/opencode.adapter.ts`

### 4.2 Design

OpenCode is a terminal-based AI coding agent. The adapter follows the same pattern as Codex/Claude Code:

```typescript
import { type AgentProviderId, OacError, type TokenEstimate, executionError } from "@open330/oac-core";
import { execa } from "execa";

import type {
  AgentAvailability,
  AgentEvent,
  AgentExecuteParams,
  AgentExecution,
  AgentProvider,
  AgentResult,
  TokenEstimateParams,
} from "./agent.interface.js";
import {
  AsyncEventQueue,
  buildFailureMessage,
  computeTotalTokens,
  estimateContextTokens,
  estimateTokenCount,
  hasBooleanFlag,
  normalizeExitCode,
  type TokenState,
} from "./shared.js";

export class OpenCodeAdapter implements AgentProvider {
  public readonly id: AgentProviderId = "opencode";
  public readonly name = "OpenCode";

  private readonly runningExecutions = new Map<string, RunningProcess>();

  public async checkAvailability(): Promise<AgentAvailability> {
    try {
      const result = await execa("opencode", ["--version"], { reject: false });
      if (result.exitCode === 0) {
        return { available: true, version: result.stdout.trim() };
      }
      return { available: false, error: result.stderr.trim() || "opencode not found" };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public execute(params: AgentExecuteParams): AgentExecution {
    // OpenCode uses: opencode run --prompt "<prompt>" --cwd <dir>
    // The exact CLI interface will need to be confirmed against the opencode docs.
    const args = ["run", "--prompt", params.prompt, "--cwd", params.workingDirectory];

    const subprocess = execa("opencode", args, {
      cwd: params.workingDirectory,
      env: { ...processEnv, ...params.env },
      reject: false,
      timeout: params.timeoutMs,
    });

    // ... same pattern as CodexAdapter: consume streams, parse events, return AgentExecution
  }

  public async estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate> {
    // Similar to Codex/Claude -- file-stat-based estimation
  }

  public async abort(executionId: string): Promise<void> {
    // SIGTERM + SIGKILL fallback pattern
  }
}
```

### 4.3 Key Differences from Codex/Claude

- Different CLI binary name and argument format
- OpenCode may use different output formats -- needs investigation
- Token tracking may work differently depending on the model used underneath
- The `checkAvailability()` call verifies `opencode` binary and configuration

### 4.4 Implementation Priority

OpenCode adapter should be implemented as a skeleton first (matching the interface), then fleshed out once the OpenCode CLI interface is confirmed. The adapter should be marked with `@experimental` JSDoc tags.

---

## 5. Agent Registry

### 5.1 New File

`packages/execution/src/agents/registry.ts`

### 5.2 Design

```typescript
import type { AgentProviderId } from "@open330/oac-core";

import type { AgentProvider } from "./agent.interface.js";
import { ClaudeCodeAdapter } from "./claude-code.adapter.js";
import { CodexAdapter } from "./codex.adapter.js";
import { OpenCodeAdapter } from "./opencode.adapter.js";

export type AgentFactory = () => AgentProvider;

const builtinFactories = new Map<AgentProviderId, AgentFactory>([
  ["claude-code", () => new ClaudeCodeAdapter()],
  ["codex", () => new CodexAdapter()],
  ["codex-cli", () => new CodexAdapter()],   // alias
  ["opencode", () => new OpenCodeAdapter()],
]);

export class AgentRegistry {
  private readonly factories = new Map<AgentProviderId, AgentFactory>(builtinFactories);
  private readonly instances = new Map<AgentProviderId, AgentProvider>();

  /**
   * Register a custom agent factory. Overwrites any existing factory for the
   * same provider ID.
   */
  public register(id: AgentProviderId, factory: AgentFactory): void {
    this.factories.set(id, factory);
    this.instances.delete(id); // invalidate cached instance
  }

  /**
   * Get an agent provider by ID, creating it lazily if needed.
   */
  public get(id: AgentProviderId): AgentProvider {
    const cached = this.instances.get(id);
    if (cached) return cached;

    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(
        `Unknown agent provider "${id}". Available: ${[...this.factories.keys()].join(", ")}`,
      );
    }

    const instance = factory();
    this.instances.set(id, instance);
    return instance;
  }

  /**
   * Resolve multiple provider IDs into agent instances, checking availability
   * for each and returning only the available ones.
   */
  public async resolveAvailable(ids: AgentProviderId[]): Promise<AgentProvider[]> {
    const agents: AgentProvider[] = [];

    for (const id of ids) {
      const agent = this.get(id);
      const availability = await agent.checkAvailability();
      if (availability.available) {
        agents.push(agent);
      }
    }

    return agents;
  }

  /**
   * Return all registered provider IDs.
   */
  public listProviders(): AgentProviderId[] {
    return [...this.factories.keys()];
  }
}

/** Default shared registry instance. */
export const defaultRegistry = new AgentRegistry();
```

### 5.3 Export from Package

Add to `packages/execution/src/index.ts`:
```typescript
export * from "./agents/registry.js";
```

---

## 6. Agent Router -- Complexity-Based Assignment

### 6.1 New File

`packages/execution/src/agents/router.ts`

### 6.2 Strategy Interface

```typescript
import type { Task, TaskComplexity, AgentProviderId } from "@open330/oac-core";

import type { AgentProvider } from "./agent.interface.js";

export interface AgentRoutingDecision {
  agent: AgentProvider;
  reason: string;
}

export interface AgentRoutingStrategy {
  readonly name: string;

  /**
   * Select the best agent for a given task from the pool of available agents.
   */
  select(task: Task, availableAgents: AgentProvider[]): AgentRoutingDecision;
}
```

### 6.3 Built-in Strategies

#### A. SingleAgentStrategy (default when one provider specified)

```typescript
export class SingleAgentStrategy implements AgentRoutingStrategy {
  public readonly name = "single";

  select(task: Task, availableAgents: AgentProvider[]): AgentRoutingDecision {
    return {
      agent: availableAgents[0],
      reason: "single agent configured",
    };
  }
}
```

#### B. RoundRobinStrategy (current behavior)

```typescript
export class RoundRobinStrategy implements AgentRoutingStrategy {
  public readonly name = "round-robin";
  private index = 0;

  select(task: Task, availableAgents: AgentProvider[]): AgentRoutingDecision {
    const agent = availableAgents[this.index % availableAgents.length];
    this.index = (this.index + 1) % availableAgents.length;
    return {
      agent,
      reason: `round-robin assignment (index ${this.index})`,
    };
  }
}
```

#### C. ComplexityBasedStrategy (new -- the main feature)

This is the core routing intelligence. The strategy maps task complexity to agent capabilities.

```typescript
/**
 * Default complexity-to-agent preference mapping.
 *
 * The rationale:
 * - Claude Code excels at complex, multi-file refactoring tasks requiring deep
 *   reasoning and long context windows.
 * - Codex is fast and cost-effective for simple, scoped changes (lint fixes,
 *   TODO resolution, single-file edits).
 * - OpenCode serves as a general-purpose fallback.
 *
 * The preference order means: try the first agent, fall back to subsequent ones
 * if the preferred agent is not in the available pool.
 */
const DEFAULT_COMPLEXITY_PREFERENCES: Record<TaskComplexity, AgentProviderId[]> = {
  trivial:  ["codex", "opencode", "claude-code"],
  simple:   ["codex", "opencode", "claude-code"],
  moderate: ["claude-code", "codex", "opencode"],
  complex:  ["claude-code", "opencode", "codex"],
};

export interface ComplexityRoutingConfig {
  preferences?: Partial<Record<TaskComplexity, AgentProviderId[]>>;
}

export class ComplexityBasedStrategy implements AgentRoutingStrategy {
  public readonly name = "complexity";
  private readonly preferences: Record<TaskComplexity, AgentProviderId[]>;

  constructor(config: ComplexityRoutingConfig = {}) {
    this.preferences = {
      ...DEFAULT_COMPLEXITY_PREFERENCES,
      ...config.preferences,
    };
  }

  select(task: Task, availableAgents: AgentProvider[]): AgentRoutingDecision {
    const agentMap = new Map(availableAgents.map(a => [a.id, a]));
    const preferenceOrder = this.preferences[task.complexity] ?? this.preferences.moderate;

    for (const preferredId of preferenceOrder) {
      const agent = agentMap.get(preferredId);
      if (agent) {
        return {
          agent,
          reason: `complexity "${task.complexity}" prefers "${preferredId}"`,
        };
      }
    }

    // Fallback: first available agent
    return {
      agent: availableAgents[0],
      reason: `fallback -- no preferred agent available for complexity "${task.complexity}"`,
    };
  }
}
```

#### D. SourceBasedStrategy (optional enhancement)

Route based on task source in addition to complexity:

```typescript
const DEFAULT_SOURCE_PREFERENCES: Partial<Record<TaskSource, AgentProviderId[]>> = {
  "lint":         ["codex", "opencode", "claude-code"],
  "todo":         ["codex", "opencode", "claude-code"],
  "github-issue": ["claude-code", "opencode", "codex"],
  "test-gap":     ["claude-code", "opencode", "codex"],
};
```

### 6.4 Router Orchestrator

```typescript
export class AgentRouter {
  constructor(
    private readonly strategy: AgentRoutingStrategy,
    private readonly availableAgents: AgentProvider[],
  ) {
    if (availableAgents.length === 0) {
      throw new Error("AgentRouter requires at least one available agent");
    }
  }

  /**
   * Select the best agent for the given task.
   */
  public route(task: Task): AgentRoutingDecision {
    return this.strategy.select(task, this.availableAgents);
  }

  /**
   * Get the routing strategy name for logging/debugging.
   */
  public get strategyName(): string {
    return this.strategy.name;
  }
}

/**
 * Factory: build the appropriate router from CLI/config options.
 */
export function createRouter(
  agents: AgentProvider[],
  strategyName?: string,
  config?: ComplexityRoutingConfig,
): AgentRouter {
  let strategy: AgentRoutingStrategy;

  if (agents.length === 1) {
    strategy = new SingleAgentStrategy();
  } else {
    switch (strategyName) {
      case "round-robin":
        strategy = new RoundRobinStrategy();
        break;
      case "complexity":
      default:
        strategy = new ComplexityBasedStrategy(config);
        break;
    }
  }

  return new AgentRouter(strategy, agents);
}
```

---

## 7. Execution Engine Changes

### 7.1 File to Modify

`packages/execution/src/engine.ts`

### 7.2 Changes

#### A. Replace round-robin with AgentRouter

Remove:
```typescript
private nextAgentIndex = 0;

private selectAgent(): AgentProvider {
  const agent = this.agents[this.nextAgentIndex % this.agents.length];
  this.nextAgentIndex = (this.nextAgentIndex + 1) % this.agents.length;
  return agent;
}
```

Replace with:
```typescript
import { type AgentRouter, createRouter } from "./agents/router.js";

// In constructor:
private readonly router: AgentRouter;

constructor(
  agents: AgentProvider[],
  eventBus: OacEventBus,
  config: ExecutionEngineConfig = {},
) {
  // ... existing code ...
  this.router = createRouter(agents, config.routingStrategy, config.routingConfig);
}

// In runJob():
private async runJob(job: Job): Promise<void> {
  // ... existing pre-amble ...

  const { agent, reason } = this.router.route(job.task);
  job.workerId = agent.id;

  // ... rest unchanged ...
}
```

#### B. Extend ExecutionEngineConfig

```typescript
export interface ExecutionEngineConfig {
  concurrency?: number;
  maxAttempts?: number;
  repoPath?: string;
  baseBranch?: string;
  branchPrefix?: string;
  taskTimeoutMs?: number;
  defaultTokenBudget?: number;
  routingStrategy?: string;               // NEW
  routingConfig?: ComplexityRoutingConfig; // NEW
}
```

#### C. Add per-agent metrics to Job

Extend the `Job` interface to track which agent was used:

```typescript
export interface Job {
  // ... existing fields ...
  agentId?: AgentProviderId;        // NEW: which agent handled this job
  routingReason?: string;           // NEW: why this agent was chosen
}
```

#### D. Emit routing decisions

In `runJob()`, after agent selection:
```typescript
this.eventBus.emit("execution:routed", {
  jobId: job.id,
  task: job.task,
  agentId: agent.id,
  reason,
});
```

#### E. Agent-aware retry logic

When a job fails, consider retrying with a different agent:

```typescript
private async handleFailure(job: Job, error: OacError): Promise<void> {
  // ... existing checks ...

  // NEW: If agent-specific failure, try a different agent on retry
  if (job.attempts < job.maxAttempts && this.agents.length > 1) {
    if (error.code === "AGENT_EXECUTION_FAILED" || error.code === "AGENT_NOT_AVAILABLE") {
      // Exclude the failed agent from the next routing decision
      job.metadata.excludeAgents = [
        ...(job.metadata.excludeAgents ?? []),
        job.agentId,
      ];
    }
  }

  // ... existing retry logic ...
}
```

---

## 8. Worker Changes

### 8.1 File to Modify

`packages/execution/src/worker.ts`

### 8.2 Changes

Minimal changes needed. The worker is already agent-agnostic. The only addition is including the `agentId` in event emissions:

```typescript
eventBus.emit("execution:progress", {
  jobId: executionId,
  agentId: agent.id,           // NEW
  tokensUsed: observedTokens,
  stage: stageFromEvent(event),
});
```

---

## 9. CLI Changes

### 9.1 File to Modify

`packages/cli/src/commands/run.ts`

### 9.2 Flag Changes

#### A. `--provider` accepts comma-separated values

Change from:
```typescript
.option("--provider <id>", "Agent provider id")
```

To:
```typescript
.option("--provider <ids>", "Agent provider id(s), comma-separated for multi-agent mode (e.g., claude-code,codex)")
```

#### B. New `--routing` flag

```typescript
.option("--routing <strategy>", "Agent routing strategy: auto|round-robin|complexity (default: auto)")
```

`auto` means: use `complexity` if multiple providers, `single` if one provider.

#### C. Provider resolution

Replace `resolveProviderId()`:

```typescript
function resolveProviderIds(
  providerOption: string | undefined,
  config: OacConfig | null,
): AgentProviderId[] {
  const fromFlag = providerOption?.trim();
  if (fromFlag) {
    return fromFlag.split(",").map(id => id.trim()).filter(Boolean) as AgentProviderId[];
  }

  // Config may specify a single provider or array of providers
  const configProvider = config?.provider.id ?? "claude-code";
  return [configProvider] as AgentProviderId[];
}
```

#### D. Replace hardcoded CodexAdapter

Replace:
```typescript
const codexAdapter = new CodexAdapter();
const codexAvailability = await codexAdapter.checkAvailability();
const useRealExecution = providerId.includes("codex") && codexAvailability.available;
```

With:
```typescript
import { defaultRegistry } from "@open330/oac-execution";

const providerIds = resolveProviderIds(options.provider, config);
const availableAgents = await defaultRegistry.resolveAvailable(providerIds);

if (availableAgents.length === 0) {
  // Fall back to simulated execution or throw error
  if (!outputJson) {
    console.log(ui.yellow("[oac] No configured agents are available. Using simulated execution."));
  }
}
```

#### E. Use ExecutionEngine instead of custom loop

The CLI currently reimplements execution concurrency. Refactor to use the `ExecutionEngine`:

```typescript
const engine = new ExecutionEngine(availableAgents, eventBus, {
  concurrency,
  maxAttempts: 2,
  repoPath: resolvedRepo.localPath,
  baseBranch: resolvedRepo.meta.defaultBranch,
  taskTimeoutMs: timeoutSeconds * 1000,
  routingStrategy: routingOption,
});

const jobs = engine.enqueue(plan);
const result = await engine.run();
```

This is a significant refactor but eliminates the code duplication between CLI, dashboard, and engine.

#### F. Per-agent display in summary

Update the summary output to show per-agent breakdown:

```
Run Summary
  Tasks completed: 5/7
  Tasks failed:    2
  PRs created:     5
  Tokens used:     45,000 / 100,000
  Duration:        2m 30s
  Agent breakdown:
    claude-code:   3 tasks (32,000 tokens)
    codex:         4 tasks (13,000 tokens)
```

---

## 10. Config Schema Changes

### 10.1 File to Modify

`packages/core/src/config.ts`

### 10.2 Extend ProviderSchema

Replace the single-provider schema:

```typescript
export const ProviderSchema = z.object({
  id: z.string().min(1).default("claude-code"),
  options: z.record(z.string(), z.unknown()).default({}),
}).strict().default({});
```

With a multi-provider schema that remains backward compatible:

```typescript
const SingleProviderSchema = z.object({
  id: z.string().min(1),
  options: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const ProviderSchema = z.union([
  // New: array of providers with routing config
  z.object({
    agents: z.array(SingleProviderSchema).min(1),
    routing: z.enum(["auto", "round-robin", "complexity"]).default("auto"),
    complexityPreferences: z.record(
      z.enum(["trivial", "simple", "moderate", "complex"]),
      z.array(z.string().min(1)),
    ).optional(),
  }).strict(),
  // Legacy: single provider (backward compatible)
  SingleProviderSchema.extend({
    id: SingleProviderSchema.shape.id.default("claude-code"),
  }).strict(),
]).default({ id: "claude-code", options: {} });
```

### 10.3 Example Config

```typescript
// Single agent (backward compatible)
export default defineConfig({
  provider: {
    id: "claude-code",
  },
});

// Multi-agent with complexity routing
export default defineConfig({
  provider: {
    agents: [
      { id: "claude-code", options: { maxTurns: 50 } },
      { id: "codex", options: {} },
    ],
    routing: "complexity",
    complexityPreferences: {
      trivial: ["codex", "claude-code"],
      simple: ["codex", "claude-code"],
      moderate: ["claude-code", "codex"],
      complex: ["claude-code"],
    },
  },
});
```

---

## 11. Dashboard Pipeline Changes

### 11.1 File to Modify

`packages/dashboard/src/pipeline.ts`

### 11.2 Changes

#### A. Replace hardcoded CodexAdapter

Replace:
```typescript
const codexAdapter = new CodexAdapter();
const codexAvailability = await codexAdapter.checkAvailability();
const useRealExecution = config.provider.includes("codex") && codexAvailability.available;
```

With:
```typescript
import { defaultRegistry, createRouter } from "@open330/oac-execution";

const providerIds = config.provider.split(",").map(s => s.trim()).filter(Boolean);
const availableAgents = await defaultRegistry.resolveAvailable(providerIds);
const router = createRouter(availableAgents, "complexity");
```

#### B. Update RunConfig type

```typescript
export interface RunConfig {
  repo: string;
  provider: string;          // Now comma-separated for multi-agent
  tokens: number;
  concurrency?: number;
  maxTasks?: number;
  source?: string;
  routing?: string;          // NEW: routing strategy
}
```

#### C. Per-task agent routing

In the task execution loop, replace the static `codexAdapter` usage with router-based selection:

```typescript
const { agent, reason } = router.route(entry.task);
emit({
  type: "run:task-start",
  taskId: entry.task.id,
  title: entry.task.title,
  agentId: agent.id,  // NEW field on the event
});

// Execute with the selected agent
const result = await executeWithAgent({
  task: entry.task,
  estimate: entry.estimate,
  agent,
  repoPath: resolvedRepo.localPath,
  baseBranch: resolvedRepo.meta.defaultBranch,
  timeoutSeconds: 300,
});
```

#### D. Replace `executeWithCodex` with `executeWithAgent`

Generalize the execution function to accept any `AgentProvider`:

```typescript
async function executeWithAgent(input: {
  task: Task;
  estimate: TokenEstimate;
  agent: AgentProvider;           // was: codexAdapter: CodexAdapter
  repoPath: string;
  baseBranch: string;
  timeoutSeconds: number;
}): Promise<{ execution: ExecutionOutcome; sandbox: SandboxInfo }> {
  // ... same logic, but uses input.agent instead of input.codexAdapter
}
```

#### E. Extend DashboardRunEvent

Add agent information to task events:

```typescript
export type DashboardRunEvent =
  | { type: "run:stage"; stage: RunStage; message: string }
  | { type: "run:progress"; progress: RunProgress }
  | { type: "run:task-start"; taskId: string; title: string; agentId?: string }    // agentId added
  | {
      type: "run:task-done";
      taskId: string;
      title: string;
      success: boolean;
      prUrl?: string;
      filesChanged: number;
      agentId?: string;           // NEW
      routingReason?: string;     // NEW
    }
  | { type: "run:completed"; summary: RunState }
  | { type: "run:error"; error: string };
```

#### F. Track per-agent stats in RunProgress

```typescript
export interface RunProgress {
  tasksDiscovered: number;
  tasksSelected: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsCreated: number;
  tokensUsed: number;
  currentTask?: string;
  prUrls: string[];
  agentBreakdown?: Record<string, {    // NEW
    tasksCompleted: number;
    tasksFailed: number;
    tokensUsed: number;
  }>;
}
```

---

## 12. Dashboard UI Changes

### 12.1 File to Modify

`packages/dashboard/src/ui.ts`

### 12.2 Changes to Start Run Form

#### A. Multi-agent provider selector

Replace the single select dropdown:
```html
<select id="run-provider">
  <option value="codex-cli">Codex CLI</option>
  <option value="claude-code">Claude Code</option>
</select>
```

With a multi-select checkboxes approach:
```html
<div class="form-group">
  <label>Agent Providers</label>
  <div class="checkbox-group" id="run-providers">
    <label class="checkbox-label">
      <input type="checkbox" value="claude-code" checked /> Claude Code
    </label>
    <label class="checkbox-label">
      <input type="checkbox" value="codex" /> Codex CLI
    </label>
    <label class="checkbox-label">
      <input type="checkbox" value="opencode" /> OpenCode
    </label>
  </div>
</div>
```

#### B. Routing strategy selector

Add a new form field:
```html
<div class="form-group">
  <label for="run-routing">Routing Strategy</label>
  <select id="run-routing">
    <option value="auto">Auto (complexity-based)</option>
    <option value="round-robin">Round Robin</option>
    <option value="complexity">Complexity-Based</option>
  </select>
</div>
```

#### C. Per-agent task display

Update `addTaskResult()` to show which agent handled each task:

```javascript
function addTaskResult(data) {
  const container = document.getElementById("task-results");
  const div = document.createElement("div");
  div.className = "task-result";
  const icon = data.success ? "\u2705" : "\u274c";
  const agentBadge = data.agentId
    ? '<span class="agent-badge agent-' + data.agentId + '">' + data.agentId + '</span>'
    : '';
  let html = '<span class="icon">' + icon + '</span>'
    + agentBadge
    + '<span>' + escapeHtml(data.title) + '</span>';
  if (data.prUrl) {
    html += ' <a href="' + escapeHtml(data.prUrl) + '" target="_blank">PR \u2197</a>';
  }
  html += '<span class="meta">' + (data.filesChanged || 0) + ' files</span>';
  div.innerHTML = html;
  container.appendChild(div);
}
```

#### D. Agent breakdown card

Add a new card section showing per-agent metrics:

```html
<div class="card" id="agent-breakdown-card" style="display: none;">
  <h2>Agent Breakdown</h2>
  <div id="agent-breakdown-content"></div>
</div>
```

Updated via SSE:
```javascript
function updateAgentBreakdown(breakdown) {
  if (!breakdown) return;
  const card = document.getElementById("agent-breakdown-card");
  card.style.display = "block";
  let html = "";
  for (const [agentId, stats] of Object.entries(breakdown)) {
    html += '<div class="stat-row">';
    html += '<span class="stat-label">' + escapeHtml(agentId) + '</span>';
    html += '<span class="stat-value">'
      + stats.tasksCompleted + ' done, '
      + stats.tasksFailed + ' failed, '
      + stats.tokensUsed.toLocaleString() + ' tokens</span>';
    html += '</div>';
  }
  document.getElementById("agent-breakdown-content").innerHTML = html;
}
```

#### E. Agent color coding (CSS)

```css
.agent-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 6px;
}
.agent-claude-code { background: #1a1a3e; color: #a78bfa; }
.agent-codex { background: #1a2e1a; color: #4ade80; }
.agent-opencode { background: #2e2a1a; color: #fbbf24; }
```

#### F. Update `startRun()` to send multi-agent config

```javascript
async function startRun() {
  const checkboxes = document.querySelectorAll('#run-providers input[type="checkbox"]:checked');
  const providers = Array.from(checkboxes).map(cb => cb.value).join(",");
  const routing = document.getElementById("run-routing").value;

  // ... existing validation ...

  const body = {
    repo, provider: providers, tokens, maxTasks, concurrency, source, routing
  };
  // ... POST to /api/v1/runs ...
}
```

---

## 13. Core Type Changes

### 13.1 File to Modify

`packages/core/src/types.ts`

### 13.2 Changes

#### A. Extend RunSummary with per-agent data

```typescript
export interface RunSummary {
  // ... existing fields ...
  agentBreakdown?: Record<AgentProviderId, {
    tasksAttempted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    tokensUsed: number;
  }>;
}
```

#### B. Extend ContributionTask with agent info

```typescript
export interface ContributionTask {
  // ... existing fields ...
  agentId?: AgentProviderId;       // NEW: which agent handled this task
  routingReason?: string;          // NEW: why this agent was chosen
}
```

#### C. Extend ContributionLog budget section

```typescript
budget: {
  provider: AgentProviderId;                    // primary provider (backward compat)
  providers?: AgentProviderId[];                // NEW: all providers used
  totalTokensBudgeted: number;
  totalTokensUsed: number;
  perAgentTokensUsed?: Record<AgentProviderId, number>;  // NEW
  estimatedCostUsd?: number;
};
```

### 13.3 Add to errors.ts

No new error codes needed. The existing `AGENT_NOT_AVAILABLE` and `AGENT_EXECUTION_FAILED` codes cover all multi-agent failure modes. However, we may want to add context fields:

```typescript
// In error context, include:
{
  agentId: "claude-code",
  availableAgents: ["codex"],
  routingStrategy: "complexity",
}
```

---

## 14. Error Handling for Mixed-Agent Runs

### 14.1 Agent Unavailability

**Scenario:** User configures `--provider claude-code,codex` but only Codex is installed.

**Handling:**
1. `AgentRegistry.resolveAvailable()` filters to only available agents
2. If at least one agent is available, proceed with reduced pool
3. If no agents are available, fail early with `AGENT_NOT_AVAILABLE` error
4. Emit a warning event for each unavailable agent:
   ```
   [oac] Warning: claude-code is not available (claude binary not found). Continuing with codex only.
   ```

### 14.2 Mid-Run Agent Failure

**Scenario:** Claude Code hits a rate limit halfway through a run while Codex is still healthy.

**Handling:**
1. The existing retry logic in `ExecutionEngine.handleFailure()` kicks in
2. On retry, the router should prefer a different agent (via `excludeAgents` in job metadata)
3. The router's `select()` method receives the exclusion list and skips those agents
4. If all agents fail for a given task, the task fails normally

Implementation in the router:

```typescript
select(
  task: Task,
  availableAgents: AgentProvider[],
  excludeAgents?: AgentProviderId[],
): AgentRoutingDecision {
  const filteredAgents = excludeAgents
    ? availableAgents.filter(a => !excludeAgents.includes(a.id))
    : availableAgents;

  if (filteredAgents.length === 0) {
    // All agents excluded -- fall back to full pool (best effort)
    return this.selectFromPool(task, availableAgents);
  }

  return this.selectFromPool(task, filteredAgents);
}
```

### 14.3 Mixed Results

**Scenario:** A run completes with some tasks handled by Claude Code and others by Codex. Claude Code tasks all succeeded but Codex tasks failed.

**Handling:**
1. The per-agent breakdown in `RunProgress.agentBreakdown` makes this visible
2. The contribution log records `agentId` per task for post-hoc analysis
3. The CLI summary shows per-agent success rates
4. No special recovery logic -- each task is independent

### 14.4 Token Budget Fairness

**Scenario:** Claude Code uses 10x more tokens per task than Codex. A shared budget gets consumed unevenly.

**Handling:**
1. Token estimation already varies by provider (each adapter has its own `estimateTokens()`)
2. The execution plan's token budgeting accounts for per-task estimates
3. No per-agent budget partitioning is needed -- the global budget applies to total consumption
4. Future enhancement: optional per-agent budget caps in config:
   ```typescript
   provider: {
     agents: [
       { id: "claude-code", options: { maxTokens: 80000 } },
       { id: "codex", options: { maxTokens: 20000 } },
     ],
   }
   ```

### 14.5 Abort Behavior

**Scenario:** User aborts a mixed-agent run.

**Handling:** The existing `ExecutionEngine.abort()` already iterates all active jobs and calls `agent.abort()` on each. Since each `ActiveJobState` tracks its own agent reference, this works correctly across mixed-agent runs with no changes needed.

### 14.6 Sandbox Isolation

Each task already gets its own git worktree sandbox via `createSandbox()`. Different agents operating on different tasks cannot interfere with each other's file changes. No changes needed.

---

## 15. New Files Summary

| File | Purpose |
|------|---------|
| `packages/execution/src/agents/shared.ts` | Shared utilities extracted from Codex/Claude adapters (AsyncEventQueue, parsing helpers, error normalization) |
| `packages/execution/src/agents/opencode.adapter.ts` | OpenCode agent adapter |
| `packages/execution/src/agents/registry.ts` | AgentRegistry singleton for lazy agent instantiation and availability checking |
| `packages/execution/src/agents/router.ts` | AgentRouter with pluggable strategies (SingleAgent, RoundRobin, ComplexityBased) |

---

## 16. Modified Files Summary

| File | Changes |
|------|---------|
| `packages/execution/src/agents/claude-code.adapter.ts` | Use `--output-format json`, `--verbose`, `--dangerously-skip-permissions`; improve token estimation; import shared utilities |
| `packages/execution/src/agents/codex.adapter.ts` | Import shared utilities instead of inline duplicates |
| `packages/execution/src/agents/agent.interface.ts` | No changes needed (interface is already sufficient) |
| `packages/execution/src/engine.ts` | Replace round-robin with AgentRouter; extend config; add routing events; agent-aware retry |
| `packages/execution/src/worker.ts` | Add `agentId` to progress events |
| `packages/execution/src/index.ts` | Export new modules (registry, router, shared, opencode adapter) |
| `packages/cli/src/commands/run.ts` | Multi-provider `--provider` flag; `--routing` flag; use AgentRegistry; refactor toward ExecutionEngine; per-agent summary display |
| `packages/dashboard/src/pipeline.ts` | Replace hardcoded CodexAdapter with registry/router; generalize `executeWithAgent`; add agentId to events |
| `packages/dashboard/src/server.ts` | Accept `routing` in RunConfig body |
| `packages/dashboard/src/ui.ts` | Multi-agent provider checkboxes; routing selector; agent badges on tasks; agent breakdown card |
| `packages/core/src/types.ts` | Add `agentId`/`routingReason` to ContributionTask; per-agent breakdown to RunSummary and ContributionLog |
| `packages/core/src/config.ts` | Extend ProviderSchema to support agent arrays and routing config |

---

## 17. Migration Path

### Phase 1: Foundation (No Breaking Changes)

1. Create `shared.ts` -- extract shared utilities
2. Refactor `codex.adapter.ts` and `claude-code.adapter.ts` to import from `shared.ts`
3. Create `registry.ts` -- agent registry with lazy instantiation
4. Create `router.ts` -- all strategies, defaulting to SingleAgentStrategy
5. Update `engine.ts` -- use router instead of round-robin
6. Update `index.ts` exports

**Verification:** All existing tests pass. Single-agent behavior unchanged.

### Phase 2: Claude Code Full Implementation

1. Upgrade `claude-code.adapter.ts` with structured JSON parsing, `--output-format json`, improved token estimation
2. Test against real Claude Code CLI
3. Verify parity with Codex adapter's feature set

### Phase 3: Multi-Agent CLI/Dashboard

1. Update CLI `--provider` flag to accept comma-separated values
2. Add `--routing` flag
3. Refactor CLI to use `AgentRegistry.resolveAvailable()`
4. Update dashboard pipeline to use registry/router
5. Update dashboard UI with multi-agent controls
6. Update config schema (backward compatible union type)

### Phase 4: OpenCode Adapter

1. Create `opencode.adapter.ts` skeleton
2. Test against real OpenCode CLI
3. Register in default registry

### Phase 5: Advanced Features

1. Per-agent budget caps
2. Source-based routing strategy
3. Agent capability metadata (context window size, supported languages, cost per token)
4. Historical performance-based routing (route to the agent with the best success rate for similar tasks)

---

## 18. Testing Strategy

### Unit Tests

- `registry.test.ts` -- register, get, resolve, list, error on unknown
- `router.test.ts` -- each strategy (single, round-robin, complexity) with various task configurations
- `shared.test.ts` -- all extracted utilities (especially AsyncEventQueue)
- `opencode.adapter.test.ts` -- availability check, execute mock, abort

### Integration Tests

- Multi-agent engine test: 2 agents, 10 tasks with mixed complexity, verify correct routing
- Fallback test: preferred agent unavailable, verify fallback to next
- Retry with agent switch: first agent fails, retry picks different agent
- Abort test: abort during mixed-agent run, verify all processes cleaned up

### E2E Tests

- CLI with `--provider claude-code,codex` against a test repo
- Dashboard run with multi-agent selection
- Config file with `agents` array

### Backward Compatibility Tests

- Existing single-agent configs still work
- `--provider codex` (single value) still works
- Dashboard form with single provider still works
- ContributionLog v1.0 without `agentId` fields still parses
