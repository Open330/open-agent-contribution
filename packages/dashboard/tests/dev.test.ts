import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startDashboardMock } = vi.hoisted(() => ({
  startDashboardMock: vi.fn(),
}));

vi.mock("../src/server.js", () => ({
  startDashboard: startDashboardMock,
}));

const originalArgv = [...process.argv];
const originalEnv = {
  OAC_PORT: process.env.OAC_PORT,
  OAC_HOST: process.env.OAC_HOST,
  OAC_DIR: process.env.OAC_DIR,
};

function restoreEnv(): void {
  if (originalEnv.OAC_PORT === undefined) {
    delete process.env.OAC_PORT;
  } else {
    process.env.OAC_PORT = originalEnv.OAC_PORT;
  }

  if (originalEnv.OAC_HOST === undefined) {
    delete process.env.OAC_HOST;
  } else {
    process.env.OAC_HOST = originalEnv.OAC_HOST;
  }

  if (originalEnv.OAC_DIR === undefined) {
    delete process.env.OAC_DIR;
  } else {
    process.env.OAC_DIR = originalEnv.OAC_DIR;
  }
}

async function importDevEntrypoint(): Promise<void> {
  vi.resetModules();
  await import("../src/dev.js");
}

beforeEach(() => {
  startDashboardMock.mockReset();
  process.argv = ["node", "dev.ts"];
  delete process.env.OAC_PORT;
  delete process.env.OAC_HOST;
  delete process.env.OAC_DIR;
});

afterEach(() => {
  process.argv = [...originalArgv];
  restoreEnv();
});

describe("dev.ts", () => {
  it("starts dashboard with default values", async () => {
    await importDevEntrypoint();

    expect(startDashboardMock).toHaveBeenCalledTimes(1);
    expect(startDashboardMock).toHaveBeenCalledWith({
      port: 3141,
      host: "0.0.0.0",
      openBrowser: false,
      oacDir: resolve(process.cwd(), "..", ".."),
    });
  });

  it("reads env vars and --open flag", async () => {
    process.env.OAC_PORT = "4200";
    process.env.OAC_HOST = "127.0.0.1";
    process.env.OAC_DIR = "/tmp/oac-dir";
    process.argv = ["node", "dev.ts", "--open"];

    await importDevEntrypoint();

    expect(startDashboardMock).toHaveBeenCalledTimes(1);
    expect(startDashboardMock).toHaveBeenCalledWith({
      port: 4200,
      host: "127.0.0.1",
      openBrowser: true,
      oacDir: "/tmp/oac-dir",
    });
  });
});
