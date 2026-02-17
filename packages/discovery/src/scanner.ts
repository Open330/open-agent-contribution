import { createHash } from "node:crypto";
import type { Task } from "@open330/oac-core";
import { LintScanner } from "./scanners/lint-scanner.js";
import { TodoScanner } from "./scanners/todo-scanner.js";
import type { ScanOptions, Scanner } from "./types.js";

interface DeduplicatedTask {
  task: Task;
  mergedSources: string[];
  duplicateTaskIds: string[];
}

/**
 * Runs multiple scanners in parallel and returns a deduplicated task list.
 */
export class CompositeScanner implements Scanner {
  public readonly id = "composite";
  public readonly name = "Composite Scanner";

  private readonly scanners: Scanner[];

  public constructor(scanners: Scanner[] = [new LintScanner(), new TodoScanner()]) {
    this.scanners = scanners;
  }

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    const settled = await Promise.allSettled(
      this.scanners.map(async (scanner) => ({
        scannerId: scanner.id,
        tasks: await scanner.scan(repoPath, options),
      })),
    );

    const collected: Array<{ scannerId: string; task: Task }> = [];

    for (const result of settled) {
      if (result.status !== "fulfilled") {
        continue;
      }

      const scannerId = result.value.scannerId;
      for (const task of result.value.tasks) {
        collected.push({ scannerId, task });
      }
    }

    const deduplicated = deduplicateTasks(collected);
    if (typeof options.maxTasks === "number" && options.maxTasks >= 0) {
      return deduplicated.slice(0, options.maxTasks);
    }

    return deduplicated;
  }
}

export function createDefaultCompositeScanner(): CompositeScanner {
  return new CompositeScanner([new LintScanner(), new TodoScanner()]);
}

function deduplicateTasks(candidates: Array<{ scannerId: string; task: Task }>): Task[] {
  const deduplicatedByHash = new Map<string, DeduplicatedTask>();

  for (const candidate of candidates) {
    const hash = taskContentHash(candidate.task);
    const existing = deduplicatedByHash.get(hash);

    if (!existing) {
      deduplicatedByHash.set(hash, {
        task: candidate.task,
        mergedSources: [candidate.scannerId],
        duplicateTaskIds: [candidate.task.id],
      });
      continue;
    }

    const preferIncoming = candidate.task.priority > existing.task.priority;
    const winner = preferIncoming ? candidate.task : existing.task;
    const loser = preferIncoming ? existing.task : candidate.task;

    const mergedSources = unique([
      ...existing.mergedSources,
      candidate.scannerId,
      String(loser.source),
    ]);
    const duplicateTaskIds = unique([...existing.duplicateTaskIds, loser.id, winner.id]);

    const winnerMetadata = toRecord(winner.metadata);
    const loserMetadata = toRecord(loser.metadata);

    deduplicatedByHash.set(hash, {
      task: {
        ...winner,
        metadata: {
          ...loserMetadata,
          ...winnerMetadata,
          mergedSources,
          duplicateTaskIds,
          dedupeHash: hash,
        },
      },
      mergedSources,
      duplicateTaskIds,
    });
  }

  const deduplicated = [...deduplicatedByHash.values()].map((entry) => entry.task);
  deduplicated.sort((left, right) => {
    const byPriority = right.priority - left.priority;
    if (byPriority !== 0) {
      return byPriority;
    }
    return left.title.localeCompare(right.title);
  });
  return deduplicated;
}

function taskContentHash(task: Task): string {
  const content = [task.source, [...task.targetFiles].sort().join(","), task.title].join("::");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
