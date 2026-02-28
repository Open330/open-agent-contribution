import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Tiktoken } from "tiktoken";

vi.mock("tiktoken", () => ({
  get_encoding: vi.fn(),
}));

function createMockEncoder(tokens: number[]): Tiktoken {
  return {
    encode: vi.fn().mockReturnValue(tokens),
    free: vi.fn(),
  } as unknown as Tiktoken;
}

async function loadProvider() {
  return import("../../src/budget/providers/codex-counter.js");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("getEncoder (via CodexTokenCounter)", () => {
  it("uses the primary encoding and caches the encoder instance", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const encoder = createMockEncoder([1, 2, 3]);
    mockedGetEncoding.mockReturnValue(encoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.countTokens("first")).toBe(3);
    expect(counter.countTokens("second")).toBe(3);
    expect(counter.encoding).toBe("o200k_base");
    expect(mockedGetEncoding).toHaveBeenCalledTimes(1);
    expect(mockedGetEncoding).toHaveBeenCalledWith("o200k_base");
  });

  it("falls back to cl100k_base when o200k_base is unavailable", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const fallbackEncoder = createMockEncoder([7]);
    mockedGetEncoding.mockImplementation((name) => {
      if (name === "o200k_base") {
        throw new Error("primary encoding unavailable");
      }

      return fallbackEncoder;
    });

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.encoding).toBe("cl100k_base");
    expect(counter.countTokens("fallback")).toBe(1);
    expect(mockedGetEncoding).toHaveBeenNthCalledWith(1, "o200k_base");
    expect(mockedGetEncoding).toHaveBeenNthCalledWith(2, "cl100k_base");
    expect(mockedGetEncoding).toHaveBeenCalledTimes(2);
  });
});

describe("CodexTokenCounter", () => {
  it("exposes codex budgeting constants", async () => {
    const { get_encoding } = await import("tiktoken");
    vi.mocked(get_encoding).mockReturnValue(createMockEncoder([]));

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.invocationOverhead).toBe(1_000);
    expect(counter.maxContextTokens).toBe(200_000);
  });

  it("counts tokens via the cached encoder", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const encoder = createMockEncoder([1, 2, 3, 4]);
    mockedGetEncoding.mockReturnValue(encoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.countTokens("hello codex")).toBe(4);
    expect(encoder.encode).toHaveBeenCalledWith("hello codex");
    expect(counter.encoding).toBe("o200k_base");
    expect(mockedGetEncoding).toHaveBeenCalledTimes(1);
  });

  it("reports fallback encoding when primary initialization fails", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    mockedGetEncoding.mockImplementation((name) => {
      if (name === "o200k_base") {
        throw new Error("primary encoding unavailable");
      }

      return createMockEncoder([]);
    });

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.encoding).toBe("cl100k_base");
  });

  it("returns zero for an empty string", async () => {
    const { get_encoding } = await import("tiktoken");
    vi.mocked(get_encoding).mockReturnValue(createMockEncoder([]));

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.countTokens("")).toBe(0);
  });
});

describe("CodexTokenCounter.reset", () => {
  it("frees the cached encoder and clears the selected encoding", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const encoder = createMockEncoder([1, 2]);
    mockedGetEncoding.mockReturnValue(encoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    counter.countTokens("init");
    expect(encoder.free).not.toHaveBeenCalled();

    counter.reset();
    expect(encoder.free).toHaveBeenCalledOnce();
  });

  it("allows the encoder to be re-created on next use after reset", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const encoder = createMockEncoder([1]);
    mockedGetEncoding.mockReturnValue(encoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    counter.countTokens("before");
    expect(mockedGetEncoding).toHaveBeenCalledTimes(1);

    counter.reset();
    counter.countTokens("after");
    expect(mockedGetEncoding).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no encoder has been initialized", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);
    const encoder = createMockEncoder([]);
    mockedGetEncoding.mockReturnValue(encoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    counter.reset();
    expect(encoder.free).not.toHaveBeenCalled();
  });

  it("resets encoding selection so it is re-detected on next access", async () => {
    const { get_encoding } = await import("tiktoken");
    const mockedGetEncoding = vi.mocked(get_encoding);

    // First: primary works
    const primaryEncoder = createMockEncoder([1]);
    mockedGetEncoding.mockReturnValue(primaryEncoder);

    const { CodexTokenCounter } = await loadProvider();
    const counter = new CodexTokenCounter();

    expect(counter.encoding).toBe("o200k_base");

    counter.reset();

    // After reset: primary fails, fallback used
    const fallbackEncoder = createMockEncoder([2]);
    mockedGetEncoding.mockImplementation((name) => {
      if (name === "o200k_base") {
        throw new Error("now unavailable");
      }

      return fallbackEncoder;
    });

    expect(counter.encoding).toBe("cl100k_base");
  });
});
