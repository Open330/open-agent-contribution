import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: ["open330/open-agent-contribution"],
  provider: {
    id: "claude-code",
  },
  budget: {
    totalTokens: 50_000,
  },
  execution: {
    concurrency: 1,
    mode: "new-pr",
    taskTimeout: 600,
  },
  discovery: {
    scanners: {
      lint: false,
      testGap: false,
    },
    issueLabels: [],
  },
  analyze: {
    autoAnalyze: false,
  },
});
