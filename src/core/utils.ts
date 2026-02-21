/**
 * Shared utility functions used across the codebase.
 */

/**
 * Truncate a string to `maxLength`, appending an ellipsis when trimmed.
 * Defaults to the unicode ellipsis `"…"` (1 char).  Pass `"..."` for the
 * three-dot ASCII variant.
 */
export function truncate(value: string, maxLength: number, ellipsis = "…"): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`;
}

/**
 * Type guard: returns `true` when `value` is a non-null object
 * (i.e.\ a `Record<string, unknown>`).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
