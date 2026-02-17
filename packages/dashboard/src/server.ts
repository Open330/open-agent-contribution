import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import { contributionLogSchema } from "@oac/tracking";
import type { ContributionLog } from "@oac/tracking";
import { buildLeaderboard } from "@oac/tracking";
import Fastify from "fastify";
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
  try {
    const content = await readFile(resolve(oacDir, ".oac", "status.json"), "utf8");
    return JSON.parse(content);
  } catch {
    return { status: "idle", message: "No active runs" };
  }
}

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

    const interval = setInterval(() => {
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
      );
    }, 10_000);

    _request.raw.on("close", () => {
      clearInterval(interval);
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
