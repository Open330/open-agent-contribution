import { describe, expect, it } from "vitest";

import { AsyncEventQueue, readNumber, readString } from "../../src/execution/agents/shared.js";

describe("readNumber", () => {
  it("returns a floored non-negative integer for positive numbers", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(3.7)).toBe(3);
    expect(readNumber(0)).toBe(0);
  });

  it("clamps negative numbers to zero", () => {
    expect(readNumber(-1)).toBe(0);
    expect(readNumber(-100.5)).toBe(0);
  });

  it("returns undefined for non-finite numbers", () => {
    expect(readNumber(Number.NaN)).toBeUndefined();
    expect(readNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readNumber(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });

  it("returns undefined for non-number types", () => {
    expect(readNumber("42")).toBeUndefined();
    expect(readNumber(null)).toBeUndefined();
    expect(readNumber(undefined)).toBeUndefined();
    expect(readNumber(true)).toBeUndefined();
    expect(readNumber({})).toBeUndefined();
  });
});

describe("readString", () => {
  it("returns the trimmed string for non-empty strings", () => {
    expect(readString("hello")).toBe("hello");
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty or whitespace-only strings", () => {
    expect(readString("")).toBeUndefined();
    expect(readString("   ")).toBeUndefined();
    expect(readString("\t\n")).toBeUndefined();
  });

  it("returns undefined for non-string types", () => {
    expect(readString(42)).toBeUndefined();
    expect(readString(null)).toBeUndefined();
    expect(readString(undefined)).toBeUndefined();
    expect(readString(true)).toBeUndefined();
    expect(readString({})).toBeUndefined();
  });
});

describe("AsyncEventQueue", () => {
  it("yields pushed values in order", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);
    queue.close();

    const results: number[] = [];
    for await (const value of queue) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it("resolves waiting consumers when values are pushed", async () => {
    const queue = new AsyncEventQueue<string>();

    const collected: string[] = [];
    const consuming = (async () => {
      for await (const value of queue) {
        collected.push(value);
      }
    })();

    queue.push("a");
    queue.push("b");
    queue.close();

    await consuming;
    expect(collected).toEqual(["a", "b"]);
  });

  it("close() causes iteration to end", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.close();

    const results: number[] = [];
    for await (const value of queue) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it("ignores pushes after close", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.close();
    queue.push(2); // should be ignored

    const results: number[] = [];
    for await (const value of queue) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it("close() is idempotent", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.close();
    queue.close(); // second close should not throw

    const results: number[] = [];
    for await (const value of queue) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it("fail() causes pending consumers to end and future next() to throw", async () => {
    const queue = new AsyncEventQueue<number>();
    const error = new Error("test failure");

    // Pending consumers (already waiting) get resolved with done: true via flush()
    const consuming = (async () => {
      const results: number[] = [];
      for await (const value of queue) {
        results.push(value);
      }
      return results;
    })();

    queue.fail(error);

    // The for-await loop exits cleanly (flush resolves pending with done: true)
    const results = await consuming;
    expect(results).toEqual([]);

    // But future next() calls throw the stored error
    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow("test failure");
  });

  it("fail() causes next() to throw for already-queued error", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.push(1);
    queue.fail(new Error("delayed failure"));

    const iterator = queue[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first).toEqual({ done: false, value: 1 });

    await expect(iterator.next()).rejects.toThrow("delayed failure");
  });

  it("yields nothing when closed immediately", async () => {
    const queue = new AsyncEventQueue<number>();
    queue.close();

    const results: number[] = [];
    for await (const value of queue) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it("flushes pending resolvers on close", async () => {
    const queue = new AsyncEventQueue<number>();

    // Start two concurrent consumers waiting
    const iterator = queue[Symbol.asyncIterator]();
    const p1 = iterator.next();
    const p2 = iterator.next();

    queue.close();

    const r1 = await p1;
    const r2 = await p2;
    expect(r1.done).toBe(true);
    expect(r2.done).toBe(true);
  });
});
