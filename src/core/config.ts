import { z } from "zod";

import { configError } from "./errors.js";

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const DEFAULT_DISCOVERY_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "*.min.js",
  "vendor/",
] as const;

export const RepoTargetSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      branch: z.string().min(1).optional(),
    })
    .strict(),
]);

export const ProviderSchema = z
  .object({
    id: z.string().min(1).default("claude-code"),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .default({});

export const BudgetSchema = z
  .object({
    totalTokens: z.number().int().positive().default(100_000),
    reservePercent: z.number().min(0).max(1).default(0.1),
    estimationPadding: z.number().positive().default(1.2),
  })
  .strict()
  .default({});

export const DiscoveryScannersSchema = z
  .object({
    lint: z.boolean().default(true),
    todo: z.boolean().default(true),
    testGap: z.boolean().default(true),
    deadCode: z.boolean().default(false),
    githubIssues: z.boolean().default(true),
  })
  .strict()
  .default({});

export const DiscoverySchema = z
  .object({
    scanners: DiscoveryScannersSchema,
    issueLabels: z.array(z.string().min(1)).default(["good-first-issue", "help-wanted", "bug"]),
    minPriority: z.number().int().min(0).max(100).default(20),
    maxTasks: z.number().int().positive().default(50),
    customScanners: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([...DEFAULT_DISCOVERY_EXCLUDE]),
  })
  .strict()
  .default({});

export const ValidationSchema = z
  .object({
    lint: z.boolean().default(true),
    test: z.boolean().default(true),
    typeCheck: z.boolean().default(true),
    maxDiffLines: z.number().int().positive().default(500),
  })
  .strict()
  .default({});

export const PrSchema = z
  .object({
    draft: z.boolean().default(false),
    labels: z.array(z.string().min(1)).default(["oac-contribution"]),
    reviewers: z.array(z.string().min(1)).default([]),
    assignees: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});

export const ExecutionSchema = z
  .object({
    concurrency: z.number().int().positive().default(2),
    taskTimeout: z.number().int().positive().default(300),
    maxRetries: z.number().int().min(0).default(2),
    mode: z.enum(["new-pr", "update-pr", "direct-commit"]).default("new-pr"),
    branchPattern: z.string().min(1).default("oac/{date}/{task}"),
    validation: ValidationSchema,
    pr: PrSchema,
  })
  .strict()
  .default({});

export const LinearIntegrationSchema = z
  .object({
    enabled: z.boolean().default(false),
    apiKey: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
  })
  .strict()
  .default({})
  .superRefine((value, ctx) => {
    if (value.enabled && !value.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "Linear integration is enabled but apiKey is missing",
      });
    }
    if (value.enabled && !value.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teamId"],
        message: "Linear integration is enabled but teamId is missing",
      });
    }
  });

export const JiraIntegrationSchema = z
  .object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
    email: z.string().min(1).optional(),
    apiToken: z.string().min(1).optional(),
    projectKey: z.string().min(1).optional(),
  })
  .strict()
  .default({})
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (!value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: "Jira integration is enabled but baseUrl is missing",
      });
    }
    if (!value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Jira integration is enabled but email is missing",
      });
    }
    if (!value.apiToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiToken"],
        message: "Jira integration is enabled but apiToken is missing",
      });
    }
    if (!value.projectKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectKey"],
        message: "Jira integration is enabled but projectKey is missing",
      });
    }
  });

export const CompletionSchema = z
  .object({
    integrations: z
      .object({
        linear: LinearIntegrationSchema,
        jira: JiraIntegrationSchema,
      })
      .strict()
      .default({}),
    monitor: z
      .object({
        enabled: z.boolean().default(false),
        pollInterval: z.number().int().positive().default(300),
        autoRespondToReviews: z.boolean().default(false),
        autoDeleteBranch: z.boolean().default(true),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({});

export const TrackingSchema = z
  .object({
    directory: z.string().min(1).default(".oac"),
    autoCommit: z.boolean().default(false),
    gitTracked: z.boolean().default(true),
  })
  .strict()
  .default({});

export const DashboardSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(3141),
    openBrowser: z.boolean().default(true),
  })
  .strict()
  .default({});

export const AnalyzeSchema = z
  .object({
    /** Auto-run analysis before `oac run` if context is stale or missing. */
    autoAnalyze: z.boolean().default(true),
    /** Max age in ms before context is considered stale (default: 24h). */
    staleAfterMs: z.number().int().positive().default(86_400_000),
    /** Directory for persisted context, relative to repo root. */
    contextDir: z.string().min(1).default(".oac/context"),
  })
  .strict()
  .default({});

export const OacConfigSchema = z
  .object({
    repos: z.array(RepoTargetSchema).default([]),
    provider: ProviderSchema,
    budget: BudgetSchema,
    discovery: DiscoverySchema,
    execution: ExecutionSchema,
    completion: CompletionSchema,
    tracking: TrackingSchema,
    dashboard: DashboardSchema,
    analyze: AnalyzeSchema,
  })
  .strict();

export const OacConfig = OacConfigSchema;
export type OacConfig = z.output<typeof OacConfigSchema>;
export type OacConfigInput = z.input<typeof OacConfigSchema>;

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
}

export function defineConfig(config: OacConfigInput): OacConfigInput {
  return config;
}

export function interpolateEnvVars(
  value: string,
  env: Record<string, string | undefined> = getProcessEnv(),
  path: string[] = [],
): string {
  return value.replaceAll(ENV_VAR_PATTERN, (_, variableName: string) => {
    const interpolated = env[variableName];
    if (interpolated !== undefined) {
      return interpolated;
    }

    throw configError(
      "CONFIG_SECRET_MISSING",
      `Environment variable ${variableName} is referenced in config but not set`,
      {
        context: {
          variableName,
          path: path.length > 0 ? path.join(".") : "<root>",
        },
      },
    );
  });
}

export function loadConfig(config: unknown = {}, options: LoadConfigOptions = {}): OacConfig {
  const env = options.env ?? getProcessEnv();
  const interpolatedConfig = interpolateConfigEnvVars(config, env);
  const parsed = OacConfigSchema.safeParse(interpolatedConfig);

  if (parsed.success) {
    return parsed.data;
  }

  throw configError("CONFIG_INVALID", "Invalid OAC configuration", {
    context: {
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
    },
  });
}

function interpolateConfigEnvVars(
  value: unknown,
  env: Record<string, string | undefined>,
  path: string[] = [],
): unknown {
  if (typeof value === "string") {
    return interpolateEnvVars(value, env, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => interpolateConfigEnvVars(item, env, [...path, `${index}`]));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const interpolatedObject: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    interpolatedObject[key] = interpolateConfigEnvVars(nestedValue, env, [...path, key]);
  }

  return interpolatedObject;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getProcessEnv(): Record<string, string | undefined> {
  const globalProcess = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return globalProcess.process?.env ?? {};
}
