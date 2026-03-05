import { beforeEach, describe, expect, it, vi } from "vitest";

const tiktokenMocks = vi.hoisted(() => {
  const free = vi.fn();
  const encode = vi.fn((text: string) => Array.from({ length: text.length }, (_, index) => index));
  const getEncoding = vi.fn(() => ({
    encode,
    free,
  }));

  return { encode, free, getEncoding };
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
  tiktokenMocks.free.mockClear();
});

describe("ClaudeTokenCounter", () => {
  it("countTokens delegates to encoder.encode and returns encoded length", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("hello")).toBe(5);
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledWith("cl100k_base");
    expect(tiktokenMocks.encode).toHaveBeenCalledWith("hello");
  });

  it("returns zero for an empty string", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("")).toBe(0);
    expect(tiktokenMocks.encode).toHaveBeenCalledWith("");
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

describe("ClaudeTokenCounter.reset", () => {
  it("frees the cached encoder", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    counter.countTokens("init");
    expect(tiktokenMocks.free).not.toHaveBeenCalled();

    counter.reset();
    expect(tiktokenMocks.free).toHaveBeenCalledOnce();
  });

  it("allows the encoder to be re-created on next use", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    counter.countTokens("before reset");
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledTimes(1);

    counter.reset();
    counter.countTokens("after reset");
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no encoder has been initialized", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    counter.reset();
    expect(tiktokenMocks.free).not.toHaveBeenCalled();
  });

  it("consecutive resets only free the encoder once", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    counter.countTokens("init");
    counter.reset();
    counter.reset();

    expect(tiktokenMocks.free).toHaveBeenCalledTimes(1);
  });

  it("reset on one instance clears the shared module-level encoder for all instances", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const a = new ClaudeTokenCounter();
    const b = new ClaudeTokenCounter();

    a.countTokens("setup");
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledTimes(1);

    b.reset();
    a.countTokens("after reset by b");
    expect(tiktokenMocks.getEncoding).toHaveBeenCalledTimes(2);
  });
});

describe("ClaudeTokenCounter.countTokens – edge cases", () => {
  it("handles whitespace-only input", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();

    expect(counter.countTokens("   ")).toBe(3);
    expect(tiktokenMocks.encode).toHaveBeenCalledWith("   ");
  });

  it("handles multi-line input", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();
    const multiLine = "line1\nline2\nline3";

    expect(counter.countTokens(multiLine)).toBe(multiLine.length);
    expect(tiktokenMocks.encode).toHaveBeenCalledWith(multiLine);
  });

  it("handles unicode input", async () => {
    const { ClaudeTokenCounter } = await loadClaudeCounterModule();
    const counter = new ClaudeTokenCounter();
    const unicode = "안녕하세요";

    expect(counter.countTokens(unicode)).toBe(unicode.length);
    expect(tiktokenMocks.encode).toHaveBeenCalledWith(unicode);
  });
});
