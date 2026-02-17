import { beforeEach, describe, expect, it, vi } from "vitest";

const tiktokenMocks = vi.hoisted(() => {
  const encode = vi.fn((text: string) =>
    Array.from({ length: text.length }, (_, index) => index),
  );
  const getEncoding = vi.fn(() => ({
    encode,
  }));

  return { encode, getEncoding };
});

vi.mock("tiktoken", () => ({
  get_encoding: tiktokenMocks.getEncoding,
}));

async function loadClaudeCounterModule() {
  return import("../../src/budget/providers/claude-counter.js");
}

beforeEach(() => {
  vi.resetModules();
  tiktokenMocks.getEncoding.mockClear();
  tiktokenMocks.encode.mockClear();
});

describe("ClaudeTokenCounter", () => {
  it("countTokens delegates to encoder.encode and returns encoded length", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("hello")).toBe(5);
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledWith("cl100k_base");
    expect(tiktokenMocks.encode).toHaveBeenCalledWith("hello");
  });

  it("getEncoder initializes the encoder once and reuses it", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const firstCounter = new ClaudeTokenCounter();
    const secondCounter = new ClaudeTokenCounter();

    firstCounter.countTokens("first");
    secondCounter.countTokens("second");

    expect(tiktokenMocks.getEncoding).toHaveBeenCalledTimes(1);
    expect(tiktokenMocks.encode).toHaveBeenCalledTimes(2);
  });

  it("exposes Claude token budget constants", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    expect(counter.invocationOverhead).toBe(1_500);
    expect(counter.maxContextTokens).toBe(200_000);
    expect(counter.encoding).toBe("cl100k_base");
  });
});
