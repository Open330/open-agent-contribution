/**
 * Shared utilities for agent adapters.
 *
 * Extracted from claude-code.adapter.ts and codex.adapter.ts to eliminate
 * ~100 lines of identical code duplicated between the two.
 */

// ── Types ───────────────────────────────────────────────────

export interface TokenState {
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
}

export interface TokenPatch {
  inputTokens?: number;
  outputTokens?: number;
  cumulativeTokens?: number;
}

// ── AsyncEventQueue ─────────────────────────────────────────

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private done = false;
  private pendingError: unknown;

  public push(value: T): void {
    if (this.done) {
      return;
    }

    const nextResolver = this.resolvers.shift();
    if (nextResolver) {
      nextResolver({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  public close(): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.flush();
  }

  public fail(error: unknown): void {
    this.pendingError = error;
    this.done = true;
    this.flush();
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        if (this.values.length > 0) {
          const value = this.values.shift();
          if (value === undefined) {
            return { done: true, value: undefined };
          }
          return { done: false, value };
        }

        if (this.pendingError !== undefined) {
          throw this.pendingError;
        }

        if (this.done) {
          return { done: true, value: undefined };
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }

  private flush(): void {
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ done: true, value: undefined });
    }
  }
}

// ── Utility functions ───────────────────────────────────────

export { isRecord } from "../../core/utils.js";

export function readNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
