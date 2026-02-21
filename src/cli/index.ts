#!/usr/bin/env node

import { runCli } from "./cli.js";
import { ConfigError, EXIT_CONFIG_ERROR, EXIT_GENERAL_ERROR } from "./commands/run/types.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = error instanceof ConfigError ? EXIT_CONFIG_ERROR : EXIT_GENERAL_ERROR;
});
