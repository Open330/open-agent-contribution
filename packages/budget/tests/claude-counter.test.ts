import { describe, expect, it } from "vitest";

import { ClaudeTokenCounter } from "../src/providers/claude-counter.js";

describe("ClaudeTokenCounter", () => {
  it("countTokens returns a positive number for non-empty text", () => {
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("This is a non-empty string.")).toBeGreaterThan(0);
  });

  it("countTokens returns 0 for empty string", () => {
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("")).toBe(0);
  });

  it("invocationOverhead is 1500", () => {
    const counter = new ClaudeTokenCounter();

    expect(counter.invocationOverhead).toBe(1_500);
  });

  it("maxContextTokens is 200000", () => {
    const counter = new ClaudeTokenCounter();

    expect(counter.maxContextTokens).toBe(200_000);
  });

  it('encoding is "cl100k_base"', () => {
    const counter = new ClaudeTokenCounter();

    expect(counter.encoding).toBe("cl100k_base");
  });
});
