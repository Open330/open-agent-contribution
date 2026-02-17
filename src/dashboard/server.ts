import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import { contributionLogSchema } from "../tracking/index.js";
import type { ContributionLog } from "../tracking/index.js";
import { buildLeaderboard } from "../tracking/index.js";
import Fastify from "fastify";
import {
  type DashboardRunEvent,
  type RunConfig,
  type RunState,
  executePipeline,
} from "./pipeline.js";
import { renderDashboardHtml } from "./ui.js";

export interface DashboardOptions {
  port: number;
  host: string;
  openBrowser: boolean;
  oacDir: string;
}

const DEFAULT_OPTIONS: DashboardOptions = {
  port: 3141,
  host: "0.0.0.0",
  openBrowser: false,
  oacDir: process.cwd(),
};

// ---------------------------------------------------------------------------
// Run state management (single-run mode)
// ---------------------------------------------------------------------------

let currentRun: RunState | null = null;
const sseClients = new Set<(event: DashboardRunEvent) => void>();

function broadcastEvent(event: DashboardRunEvent): void {
  for (const send of sseClients) {
    try {
      send(event);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------

async function readContributionLogs(oacDir: string): Promise<ContributionLog[]> {
  const contributionsPath = resolve(oacDir, ".oac", "contributions");

  let entries: Dirent[];
  try {
    entries = await readdir(contributionsPath, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const logs: ContributionLog[] = [];
  for (const fileName of files) {
    try {
      const content = await readFile(resolve(contributionsPath, fileName), "utf8");
      const parsed = contributionLogSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        logs.push(parsed.data);
      }
    } catch {
      // skip invalid files
    }
  }

  return logs;
}

async function readRunStatus(oacDir: string): Promise<unknown> {
  // Return live run state if a run is active
  if (currentRun) {
    return currentRun;
  }

  try {
    const content = await readFile(resolve(oacDir, ".oac", "status.json"), "utf8");
    return JSON.parse(content);
  } catch {
    return { status: "idle", message: "No active runs" };
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function createDashboardServer(
  options: Partial<DashboardOptions> = {},
): Promise<ReturnType<typeof Fastify>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // --- HTML Dashboard ---
  app.get("/", async (_request, reply) => {
    reply.type("text/html").send(renderDashboardHtml(opts.port));
  });

  // --- API Routes ---
  app.get("/api/v1/status", async () => {
    return readRunStatus(opts.oacDir);
  });

  app.get("/api/v1/logs", async () => {
    const logs = await readContributionLogs(opts.oacDir);
    return { count: logs.length, logs };
  });

  app.get("/api/v1/leaderboard", async () => {
    const leaderboard = await buildLeaderboard(opts.oacDir);
    return leaderboard;
  });

  app.get("/api/v1/config", async () => {
    return {
      oacDir: opts.oacDir,
      port: opts.port,
      host: opts.host,
    };
  });

  // --- Start Run ---
  app.post("/api/v1/runs", async (request, reply) => {
    // Only one run at a time
    if (currentRun && currentRun.status === "running") {
      reply.code(409).send({ error: "A run is already in progress", runId: currentRun.runId });
      return;
    }

    const body = request.body as Partial<RunConfig> | null;
    if (!body?.repo || !body.provider || !body.tokens) {
      reply.code(400).send({ error: "Missing required fields: repo, provider, tokens" });
      return;
    }

    const config: RunConfig = {
      repo: body.repo,
      provider: body.provider,
      tokens: body.tokens,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
      maxTasks: body.maxTasks,
      source: body.source,
    };

    // Initialize run state
    const runId = randomUUID();
    currentRun = {
      runId,
      status: "running",
      stage: "resolving",
      config,
      startedAt: new Date().toISOString(),
      progress: {
        tasksDiscovered: 0,
        tasksSelected: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        prsCreated: 0,
        tokensUsed: 0,
        prUrls: [],
      },
    };

    // Fire-and-forget: pipeline runs in background
    executePipeline(config, (event) => {
      // Update currentRun from events
      if (event.type === "run:stage" && currentRun) {
        currentRun.stage = event.stage;
      }
      if (event.type === "run:progress" && currentRun) {
        currentRun.progress = event.progress;
      }
      if (event.type === "run:completed" && currentRun) {
        currentRun.status = "completed";
        currentRun.completedAt = new Date().toISOString();
      }
      if (event.type === "run:error" && currentRun) {
        currentRun.status = "failed";
        currentRun.error = event.error;
        currentRun.completedAt = new Date().toISOString();
      }

      // Broadcast to all SSE clients
      broadcastEvent(event);
    }).catch((err) => {
      if (currentRun) {
        currentRun.status = "failed";
        currentRun.error = err instanceof Error ? err.message : String(err);
        currentRun.completedAt = new Date().toISOString();
      }
    });

    reply.code(202).send({ runId, status: "started" });
  });

  // --- SSE Event Stream ---
  app.get("/api/v1/events", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
    );

    // Register for run event broadcasts
    const sendEvent = (event: DashboardRunEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    sseClients.add(sendEvent);

    const interval = setInterval(() => {
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
      );
    }, 10_000);

    _request.raw.on("close", () => {
      clearInterval(interval);
      sseClients.delete(sendEvent);
    });
  });

  return app;
}

export async function startDashboard(options: Partial<DashboardOptions> = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const app = await createDashboardServer(opts);

  await app.listen({ port: opts.port, host: opts.host });
  const url =
    opts.host === "0.0.0.0" ? `http://localhost:${opts.port}` : `http://${opts.host}:${opts.port}`;
  console.log(`\n  🚀 OAC Dashboard running at ${url}`);
  console.log(`     Network: http://0.0.0.0:${opts.port}`);
  console.log(`\n  API: ${url}/api/v1/status`);
  console.log(`  SSE: ${url}/api/v1/events\n`);

  if (opts.openBrowser) {
    const { exec } = await import("node:child_process");
    const command =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${command} ${url}`);
  }
}
