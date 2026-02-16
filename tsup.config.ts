import { defineConfig } from "tsup";

export default defineConfig({
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
});
