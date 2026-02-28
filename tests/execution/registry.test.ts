import { describe, expect, it } from "vitest";

import { adapterRegistry } from "../../src/execution/agents/registry.js";

describe("AdapterRegistry", () => {
  it("has built-in claude-code adapter registered", () => {
    const factory = adapterRegistry.get("claude-code");
    expect(factory).toBeDefined();
    const adapter = factory!();
    expect(adapter.id).toBe("claude-code");
    expect(adapter.name).toBe("Claude Code");
  });

  it("has built-in codex adapter registered", () => {
    const factory = adapterRegistry.get("codex");
    expect(factory).toBeDefined();
    const adapter = factory!();
    expect(adapter.id).toBe("codex");
    expect(adapter.name).toBe("Codex CLI");
  });

  it("has built-in opencode adapter registered", () => {
    const factory = adapterRegistry.get("opencode");
    expect(factory).toBeDefined();
    const adapter = factory!();
    expect(adapter.id).toBe("opencode");
    expect(adapter.name).toBe("OpenCode");
  });

  it("resolves codex-cli alias to codex", () => {
    const factory = adapterRegistry.get("codex-cli");
    expect(factory).toBeDefined();
    const adapter = factory!();
    expect(adapter.id).toBe("codex");
  });

  it("resolveId returns canonical ID for aliases", () => {
    expect(adapterRegistry.resolveId("codex-cli")).toBe("codex");
  });

  it("resolveId returns the same ID when no alias exists", () => {
    expect(adapterRegistry.resolveId("claude-code")).toBe("claude-code");
    expect(adapterRegistry.resolveId("unknown-id")).toBe("unknown-id");
  });

  it("returns undefined for unregistered providers", () => {
    expect(adapterRegistry.get("nonexistent")).toBeUndefined();
  });

  it("registeredIds includes all built-in providers", () => {
    const ids = adapterRegistry.registeredIds();
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex");
    expect(ids).toContain("opencode");
  });

  it("register adds a new custom adapter factory", () => {
    const mockFactory = () => ({
      id: "custom" as const,
      name: "Custom Agent",
      checkAvailability: async () => ({ available: true }),
      execute: () => {
        throw new Error("not implemented");
      },
      estimateTokens: async () => {
        throw new Error("not implemented");
      },
      abort: async () => {},
    });

    adapterRegistry.register("custom" as never, mockFactory as never);
    const factory = adapterRegistry.get("custom" as never);
    expect(factory).toBeDefined();
    expect(factory!().name).toBe("Custom Agent");
  });

  it("register replaces existing factory for same ID", () => {
    const factory1 = () => ({
      id: "replaceable" as const,
      name: "V1",
      checkAvailability: async () => ({ available: true }),
      execute: () => {
        throw new Error("not implemented");
      },
      estimateTokens: async () => {
        throw new Error("not implemented");
      },
      abort: async () => {},
    });
    const factory2 = () => ({
      id: "replaceable" as const,
      name: "V2",
      checkAvailability: async () => ({ available: true }),
      execute: () => {
        throw new Error("not implemented");
      },
      estimateTokens: async () => {
        throw new Error("not implemented");
      },
      abort: async () => {},
    });

    adapterRegistry.register("replaceable" as never, factory1 as never);
    adapterRegistry.register("replaceable" as never, factory2 as never);
    expect(adapterRegistry.get("replaceable" as never)!().name).toBe("V2");
  });

  it("alias maps a new alias to an existing canonical ID", () => {
    adapterRegistry.alias("cc", "claude-code");
    const factory = adapterRegistry.get("cc");
    expect(factory).toBeDefined();
    expect(factory!().id).toBe("claude-code");
    expect(adapterRegistry.resolveId("cc")).toBe("claude-code");
  });

  it("each factory call creates a fresh adapter instance", () => {
    const factory = adapterRegistry.get("claude-code")!;
    const a = factory();
    const b = factory();
    expect(a).not.toBe(b);
  });
});
