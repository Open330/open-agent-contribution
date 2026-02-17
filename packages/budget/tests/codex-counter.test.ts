import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockEncoder {
  encode: (text: string) => number[];
}

async function loadCounterWithMock(getEncoding: (encoding: string) => MockEncoder) {
  vi.resetModules();
  vi.doMock("tiktoken", () => ({
    get_encoding: vi.fn(getEncoding),
  }));

  const module = await import("../src/providers/codex-counter.js");
  const tiktoken = await import("tiktoken");

  return {
    CodexTokenCounter: module.CodexTokenCounter,
    getEncodingMock: vi.mocked(tiktoken.get_encoding),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.doUnmock("tiktoken");
  vi.resetModules();
});

describe("CodexTokenCounter", () => {
  it("uses primary encoding and tokenizes text", async () => {
    const encoder: MockEncoder = {
      encode: vi.fn((text: string) => Array.from(text, (_, index) => index)),
    };
    const { CodexTokenCounter, getEncodingMock } = await loadCounterWithMock(() => encoder);

    const counter = new CodexTokenCounter();

    expect(counter.encoding).toBe("o200k_base");
    expect(counter.countTokens("abc")).toBe(3);
    expect(getEncodingMock).toHaveBeenCalledTimes(1);
    expect(getEncodingMock).toHaveBeenCalledWith("o200k_base");
    expect(encoder.encode).toHaveBeenCalledWith("abc");
  });

  it("falls back to cl100k_base when o200k_base is unavailable", async () => {
    const fallbackEncoder: MockEncoder = {
      encode: vi.fn((text: string) => Array.from(text, (_, index) => index)),
    };
    const { CodexTokenCounter, getEncodingMock } = await loadCounterWithMock((encoding) => {
      if (encoding === "o200k_base") {
        throw new Error("missing primary encoding");
      }

      return fallbackEncoder;
    });

    const counter = new CodexTokenCounter();

    expect(counter.encoding).toBe("cl100k_base");
    expect(counter.countTokens("abcd")).toBe(4);
    expect(getEncodingMock).toHaveBeenCalledTimes(2);
    expect(getEncodingMock.mock.calls[0]?.[0]).toBe("o200k_base");
    expect(getEncodingMock.mock.calls[1]?.[0]).toBe("cl100k_base");
  });

  it("caches encoder instance after the first lookup", async () => {
    const encoder: MockEncoder = {
      encode: vi.fn((text: string) => Array.from(text, (_, index) => index)),
    };
    const { CodexTokenCounter, getEncodingMock } = await loadCounterWithMock(() => encoder);

    const counter = new CodexTokenCounter();

    expect(counter.countTokens("a")).toBe(1);
    expect(counter.countTokens("bb")).toBe(2);
    expect(counter.encoding).toBe("o200k_base");
    expect(getEncodingMock).toHaveBeenCalledTimes(1);
  });

  it("exposes static budget constants", async () => {
    const encoder: MockEncoder = {
      encode: vi.fn((text: string) => Array.from(text, (_, index) => index)),
    };
    const { CodexTokenCounter } = await loadCounterWithMock(() => encoder);

    const counter = new CodexTokenCounter();

    expect(counter.invocationOverhead).toBe(1_000);
    expect(counter.maxContextTokens).toBe(200_000);
  });
});
