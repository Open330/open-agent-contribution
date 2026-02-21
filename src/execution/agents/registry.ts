import type { AgentProvider } from "./agent.interface.js";
import { ClaudeCodeAdapter } from "./claude-code.adapter.js";
import { CodexAdapter } from "./codex.adapter.js";
import { OpenCodeAdapter } from "./opencode.adapter.js";

/**
 * Factory function that creates a new adapter instance.
 *
 * Using factories (rather than singleton instances) ensures each
 * concurrent pipeline run gets its own `runningExecutions` map.
 */
export type AdapterFactory = () => AgentProvider;

/**
 * Maintains a registry of agent adapter factories keyed by provider ID.
 *
 * Built-in adapters (claude-code, codex, opencode) are registered at
 * module load time.  Custom adapters can be added at runtime with
 * `adapterRegistry.register(id, factory)`.
 */
class AdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  /** Well-known aliases (e.g. legacy IDs) that map to canonical provider IDs. */
  private readonly aliases = new Map<string, string>([["codex-cli", "codex"]]);

  /** Register a new adapter factory. Replaces any previous factory for the same ID. */
  register(id: string, factory: AdapterFactory): void {
    this.factories.set(id, factory);
  }

  /** Add an alias that maps to an existing canonical ID. */
  alias(alias: string, canonicalId: string): void {
    this.aliases.set(alias, canonicalId);
  }

  /** Resolve an ID (including aliases) and return the factory, or `undefined`. */
  get(rawId: string): AdapterFactory | undefined {
    const canonicalId = this.aliases.get(rawId) ?? rawId;
    return this.factories.get(canonicalId);
  }

  /** Canonical ID after alias resolution. */
  resolveId(rawId: string): string {
    return this.aliases.get(rawId) ?? rawId;
  }

  /** All registered canonical provider IDs. */
  registeredIds(): string[] {
    return [...this.factories.keys()];
  }
}

/**
 * Global singleton registry with built-in adapters pre-registered.
 */
export const adapterRegistry = new AdapterRegistry();

// ── Register built-in adapters ───────────────────────────────
adapterRegistry.register("claude-code", () => new ClaudeCodeAdapter());
adapterRegistry.register("codex", () => new CodexAdapter());
adapterRegistry.register("opencode", () => new OpenCodeAdapter());
