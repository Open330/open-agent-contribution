import { describe, expect, it } from "vitest";

import { CodexTokenCounter } from "../src/providers/codex-counter.js";

describe("CodexTokenCounter", () => {
  it("countTokens returns a positive number for non-empty text", () => {
    const counter = new CodexTokenCounter();

    expect(counter.countTokens("This is a non-empty string.")).toBeGreaterThan(0);
  });

  it("countTokens returns 0 for empty string", () => {
    const counter = new CodexTokenCounter();

    expect(counter.countTokens("")).toBe(0);
  });

  it("invocationOverhead is 1000", () => {
    const counter = new CodexTokenCounter();

    expect(counter.invocationOverhead).toBe(1_000);
  });

  it("maxContextTokens is 200000", () => {
    const counter = new CodexTokenCounter();

    expect(counter.maxContextTokens).toBe(200_000);
  });

  it("encoding returns a valid encoding name", () => {
    const counter = new CodexTokenCounter();

    expect(["o200k_base", "cl100k_base"]).toContain(counter.encoding);
  });
});
