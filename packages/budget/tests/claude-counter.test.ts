import { beforeEach, describe, expect, it, vi } from "vitest";

const tiktokenMock = vi.hoisted(() => ({
  encode: vi.fn((text: string) => (text.length === 0 ? [] : [1, 2, 3])),
  getEncoding: vi.fn(),
}));

tiktokenMock.getEncoding.mockImplementation(() => ({
  encode: tiktokenMock.encode,
}));

vi.mock("tiktoken", () => ({
  get_encoding: tiktokenMock.getEncoding,
}));

async function loadClaudeCounter() {
  return import("../src/providers/claude-counter.js");
}

describe("ClaudeTokenCounter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tiktokenMock.getEncoding.mockImplementation(() => ({
      encode: tiktokenMock.encode,
    }));
  });

  it("lazily initializes the encoder when token counting starts", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounter();
    const counter = new ClaudeTokenCounter();

    expect(tiktokenMock.getEncoding).not.toHaveBeenCalled();

    counter.countTokens("text");

    expect(tiktokenMock.getEncoding).toHaveBeenCalledTimes(1);
    expect(tiktokenMock.getEncoding).toHaveBeenCalledWith("cl100k_base");
  });

  it("reuses the same encoder across calls and instances", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounter();
    const first = new ClaudeTokenCounter();
    const second = new ClaudeTokenCounter();

    expect(first.countTokens("hello")).toBe(3);
    expect(first.countTokens("")).toBe(0);
    expect(second.countTokens("world")).toBe(3);

    expect(tiktokenMock.getEncoding).toHaveBeenCalledTimes(1);
    expect(tiktokenMock.encode).toHaveBeenNthCalledWith(1, "hello");
    expect(tiktokenMock.encode).toHaveBeenNthCalledWith(2, "");
    expect(tiktokenMock.encode).toHaveBeenNthCalledWith(3, "world");
  });

  it("exposes expected claude limits and encoding metadata", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounter();
    const counter = new ClaudeTokenCounter();

    expect(counter.invocationOverhead).toBe(1_500);
    expect(counter.maxContextTokens).toBe(200_000);
    expect(counter.encoding).toBe("cl100k_base");
  });
});
