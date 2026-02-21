/**
 * Memory pressure monitoring utilities.
 *
 * Provides lightweight heap-usage checks that callers can use to
 * throttle work when the process is approaching memory limits.
 */

/** Default threshold: pause work when heap usage exceeds 85% of the limit. */
const DEFAULT_PRESSURE_RATIO = 0.85;

export interface MemorySnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  rssUsedMB: number;
  /** Ratio of heapUsed / heapTotal (0–1). */
  heapPressure: number;
  /** True when heapPressure exceeds the configured threshold. */
  isUnderPressure: boolean;
}

/**
 * Take a snapshot of current memory usage.
 *
 * @param pressureRatio - Threshold ratio (0–1) above which `isUnderPressure`
 *   is set to `true`. Defaults to 0.85.
 */
export function getMemorySnapshot(pressureRatio = DEFAULT_PRESSURE_RATIO): MemorySnapshot {
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / 1_048_576;
  const heapTotalMB = mem.heapTotal / 1_048_576;
  const rssUsedMB = mem.rss / 1_048_576;
  const heapPressure = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;

  return {
    heapUsedMB: Math.round(heapUsedMB * 10) / 10,
    heapTotalMB: Math.round(heapTotalMB * 10) / 10,
    rssUsedMB: Math.round(rssUsedMB * 10) / 10,
    heapPressure: Math.round(heapPressure * 1000) / 1000,
    isUnderPressure: heapPressure >= pressureRatio,
  };
}

/**
 * Creates a monitor that periodically checks memory pressure and calls
 * `onPressure` when the threshold is exceeded.  The monitor can be used
 * to pause a PQueue or reduce concurrency under load.
 *
 * Returns a `stop` function to clear the interval.
 */
export function createMemoryMonitor(options: {
  /** Polling interval in milliseconds (default: 5 000). */
  intervalMs?: number;
  /** Heap pressure ratio threshold (default: 0.85). */
  pressureRatio?: number;
  /** Called when heap pressure exceeds the threshold. */
  onPressure: (snapshot: MemorySnapshot) => void;
  /** Called when heap pressure drops back below the threshold. */
  onRelief?: (snapshot: MemorySnapshot) => void;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 5_000;
  const pressureRatio = options.pressureRatio ?? DEFAULT_PRESSURE_RATIO;
  let wasPressured = false;

  const timer = setInterval(() => {
    const snapshot = getMemorySnapshot(pressureRatio);

    if (snapshot.isUnderPressure && !wasPressured) {
      wasPressured = true;
      options.onPressure(snapshot);
    } else if (!snapshot.isUnderPressure && wasPressured) {
      wasPressured = false;
      options.onRelief?.(snapshot);
    }
  }, intervalMs);

  // Unref so this doesn't keep the process alive
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
