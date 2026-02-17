import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "repo/index": "src/repo/index.ts",
    "discovery/index": "src/discovery/index.ts",
    "budget/index": "src/budget/index.ts",
    "execution/index": "src/execution/index.ts",
    "completion/index": "src/completion/index.ts",
    "tracking/index": "src/tracking/index.ts",
    "cli/index": "src/cli/index.ts",
    "cli/cli": "src/cli/cli.ts",
    "dashboard/index": "src/dashboard/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node24",
  define: {
    __OAC_VERSION__: JSON.stringify(pkg.version),
  },
  banner: ({ entryPoint }) =>
    entryPoint === "src/cli/index.ts" ? { js: "#!/usr/bin/env node" } : {},
});
