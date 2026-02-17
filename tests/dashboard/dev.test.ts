import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startDashboardMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/dashboard/server.js", () => ({
  startDashboard: startDashboardMock,
}));

const originalArgv = [...process.argv];
const originalOacPort = process.env.OAC_PORT;
const originalOacHost = process.env.OAC_HOST;
const originalOacDir = process.env.OAC_DIR;

async function importDevEntrypoint(): Promise<void> {
  await import("../../src/dashboard/dev.js");
}

beforeEach(() => {
  vi.resetModules();
  startDashboardMock.mockReset();

  process.argv = ["node", "src/dashboard/dev.ts"];
  delete process.env.OAC_PORT;
  delete process.env.OAC_HOST;
  delete process.env.OAC_DIR;
});

afterEach(() => {
  process.argv = [...originalArgv];

  if (originalOacPort === undefined) {
    delete process.env.OAC_PORT;
  } else {
    process.env.OAC_PORT = originalOacPort;
  }

  if (originalOacHost === undefined) {
    delete process.env.OAC_HOST;
  } else {
    process.env.OAC_HOST = originalOacHost;
  }

  if (originalOacDir === undefined) {
    delete process.env.OAC_DIR;
  } else {
    process.env.OAC_DIR = originalOacDir;
  }

  vi.restoreAllMocks();
});

describe("dashboard dev entrypoint", () => {
  it("starts the dashboard with default values", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/repo/src/dashboard");

    await importDevEntrypoint();

    expect(startDashboardMock).toHaveBeenCalledTimes(1);
    expect(startDashboardMock).toHaveBeenCalledWith({
      port: 3141,
      host: "0.0.0.0",
      openBrowser: false,
      oacDir: resolve("/tmp/repo/src/dashboard", "..", ".."),
    });
  });

  it("respects environment overrides and the --open flag", async () => {
    process.env.OAC_PORT = "4242";
    process.env.OAC_HOST = "127.0.0.1";
    process.env.OAC_DIR = "/tmp/custom-oac";
    process.argv = ["node", "src/dashboard/dev.ts", "--open"];

    await importDevEntrypoint();

    expect(startDashboardMock).toHaveBeenCalledTimes(1);
    expect(startDashboardMock).toHaveBeenCalledWith({
      port: 4242,
      host: "127.0.0.1",
      openBrowser: true,
      oacDir: "/tmp/custom-oac",
    });
  });

  it("falls back to default port when OAC_PORT is invalid", async () => {
    process.env.OAC_PORT = "invalid";

    await importDevEntrypoint();

    expect(startDashboardMock).toHaveBeenCalledTimes(1);
    expect(startDashboardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3141,
      }),
    );
  });
});
