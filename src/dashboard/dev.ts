import { resolve } from "node:path";
import { startDashboard } from "./server.js";

const port = Number(process.env.OAC_PORT) || 3141;
const host = process.env.OAC_HOST || "0.0.0.0";
const open = process.argv.includes("--open");
const oacDir = process.env.OAC_DIR || resolve(process.cwd(), "..", "..");

startDashboard({ port, host, openBrowser: open, oacDir });
