import { describe, expect, it } from "vitest";

import {
  OacConfigSchema,
  defineConfig,
  interpolateEnvVars,
  loadConfig,
} from "../../src/core/config.js";
import { OacError } from "../../src/core/errors.js";

describe("default config values", () => {
  it("produces a fully-populated config from an empty object", () => {
    const config = loadConfig({});

    expect(config.repos).toEqual([]);
    expect(config.provider.id).toBe("claude-code");
    expect(config.provider.options).toEqual({});
    expect(config.budget.totalTokens).toBe(100_000);
    expect(config.budget.reservePercent).toBe(0.1);
    expect(config.budget.estimationPadding).toBe(1.2);
  });

  it("has correct discovery defaults", () => {
    const config = loadConfig({});

    expect(config.discovery.scanners.lint).toBe(true);
    expect(config.discovery.scanners.todo).toBe(true);
    expect(config.discovery.scanners.testGap).toBe(true);
    expect(config.discovery.scanners.deadCode).toBe(false);
    expect(config.discovery.scanners.githubIssues).toBe(true);
    expect(config.discovery.issueLabels).toEqual(["good-first-issue", "help-wanted", "bug"]);
    expect(config.discovery.minPriority).toBe(20);
    expect(config.discovery.maxTasks).toBe(50);
    expect(config.discovery.customScanners).toEqual([]);
    expect(config.discovery.exclude).toEqual([
      "node_modules",
      "dist",
      "build",
      ".git",
      "*.min.js",
      "vendor/",
    ]);
  });

  it("has correct execution defaults", () => {
    const config = loadConfig({});

    expect(config.execution.concurrency).toBe(2);
    expect(config.execution.taskTimeout).toBe(300);
    expect(config.execution.maxRetries).toBe(2);
    expect(config.execution.mode).toBe("new-pr");
    expect(config.execution.branchPattern).toBe("oac/{date}/{task}");
    expect(config.execution.validation.lint).toBe(true);
    expect(config.execution.validation.test).toBe(true);
    expect(config.execution.validation.typeCheck).toBe(true);
    expect(config.execution.validation.maxDiffLines).toBe(500);
    expect(config.execution.pr.draft).toBe(false);
    expect(config.execution.pr.labels).toEqual(["oac-contribution"]);
    expect(config.execution.pr.reviewers).toEqual([]);
    expect(config.execution.pr.assignees).toEqual([]);
  });

  it("has correct tracking defaults", () => {
    const config = loadConfig({});

    expect(config.tracking.directory).toBe(".oac");
    expect(config.tracking.autoCommit).toBe(false);
    expect(config.tracking.gitTracked).toBe(true);
  });

  it("has correct dashboard defaults", () => {
    const config = loadConfig({});

    expect(config.dashboard.port).toBe(3141);
    expect(config.dashboard.openBrowser).toBe(true);
  });

  it("has correct context policy defaults", () => {
    const config = loadConfig({});

    expect(config.context.mode).toBe("off");
    expect(config.context.requiredGlobs).toEqual([".context/plans/**/*.md"]);
    expect(config.context.maxAckItems).toBe(3);
  });

  it("has correct completion defaults", () => {
    const config = loadConfig({});

    expect(config.completion.integrations.linear.enabled).toBe(false);
    expect(config.completion.integrations.jira.enabled).toBe(false);
    expect(config.completion.monitor.enabled).toBe(false);
    expect(config.completion.monitor.pollInterval).toBe(300);
    expect(config.completion.monitor.autoRespondToReviews).toBe(false);
    expect(config.completion.monitor.autoDeleteBranch).toBe(true);
  });
});

describe("defineConfig", () => {
  it("returns the input object unchanged (passthrough)", () => {
    const input = {
      repos: ["owner/repo"],
      budget: { totalTokens: 50_000 },
    };

    const result = defineConfig(input);
    expect(result).toBe(input);
  });

  it("accepts an empty object", () => {
    const input = {};
    const result = defineConfig(input);
    expect(result).toBe(input);
  });

  it("accepts a fully specified config", () => {
    const input = {
      repos: [{ name: "owner/repo", branch: "develop" }],
      provider: { id: "codex-cli", options: { model: "o3" } },
      budget: { totalTokens: 200_000, reservePercent: 0.2, estimationPadding: 1.5 },
    };

    const result = defineConfig(input);
    expect(result).toBe(input);
    expect(result.repos).toHaveLength(1);
    expect(result.budget?.totalTokens).toBe(200_000);
  });
});

describe("environment variable interpolation", () => {
  it("replaces ${VAR} with the environment value", () => {
    const env = { MY_TOKEN: "secret-123" };
    const result = interpolateEnvVars("Bearer ${MY_TOKEN}", env);
    expect(result).toBe("Bearer secret-123");
  });

  it("replaces multiple variables in one string", () => {
    const env = { HOST: "localhost", PORT: "8080" };
    const result = interpolateEnvVars("${HOST}:${PORT}", env);
    expect(result).toBe("localhost:8080");
  });

  it("returns string unchanged when no variables are present", () => {
    const env = {};
    const result = interpolateEnvVars("no variables here", env);
    expect(result).toBe("no variables here");
  });

  it("throws OacError with code CONFIG_SECRET_MISSING for undefined variable", () => {
    const env = {};
    expect(() => interpolateEnvVars("${MISSING_VAR}", env)).toThrow(OacError);

    try {
      interpolateEnvVars("${MISSING_VAR}", env);
    } catch (error) {
      expect(error).toBeInstanceOf(OacError);
      const oacError = error as OacError;
      expect(oacError.code).toBe("CONFIG_SECRET_MISSING");
      expect(oacError.severity).toBe("fatal");
      expect(oacError.context?.variableName).toBe("MISSING_VAR");
    }
  });

  it("interpolates env vars in nested config objects via loadConfig", () => {
    const rawConfig = {
      completion: {
        integrations: {
          linear: {
            enabled: true,
            apiKey: "${LINEAR_API_KEY}",
            teamId: "team-1",
          },
        },
      },
    };

    const config = loadConfig(rawConfig, {
      env: { LINEAR_API_KEY: "lin_key_abc" },
    });

    expect(config.completion.integrations.linear.apiKey).toBe("lin_key_abc");
  });

  it("interpolates env vars inside arrays", () => {
    const rawConfig = {
      repos: ["${REPO_NAME}"],
    };

    const config = loadConfig(rawConfig, {
      env: { REPO_NAME: "owner/repo" },
    });

    expect(config.repos).toEqual(["owner/repo"]);
  });
});

describe("loadConfig validation errors", () => {
  it("throws OacError with CONFIG_INVALID for unknown top-level keys", () => {
    expect(() => loadConfig({ unknownField: true })).toThrow(OacError);

    try {
      loadConfig({ unknownField: true });
    } catch (error) {
      const oacError = error as OacError;
      expect(oacError.code).toBe("CONFIG_INVALID");
      expect(oacError.severity).toBe("fatal");
    }
  });

  it("throws for invalid budget values", () => {
    expect(() => loadConfig({ budget: { totalTokens: -1 } })).toThrow(OacError);
  });

  it("parses valid config with overrides", () => {
    const config = loadConfig({
      budget: { totalTokens: 200_000 },
      execution: { concurrency: 4 },
    });

    expect(config.budget.totalTokens).toBe(200_000);
    expect(config.execution.concurrency).toBe(4);
    // defaults still applied for non-overridden fields
    expect(config.budget.reservePercent).toBe(0.1);
  });
});
