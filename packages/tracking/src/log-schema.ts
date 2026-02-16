import { z } from "zod";

export const taskSourceValues = [
  "lint",
  "todo",
  "test-gap",
  "dead-code",
  "github-issue",
  "github-pr-review",
  "custom",
] as const;

export const taskComplexityValues = ["trivial", "simple", "moderate", "complex"] as const;

export const contributionTaskStatusValues = ["success", "partial", "failed"] as const;

export type TaskSource = (typeof taskSourceValues)[number];
export type TaskComplexity = (typeof taskComplexityValues)[number];
export type ContributionTaskStatus = (typeof contributionTaskStatusValues)[number];
export type AgentProviderId = string;

const githubUsernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^(?!-)[A-Za-z0-9-]+(?<!-)$/, "Invalid GitHub username.");

export const contributionTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  source: z.enum(taskSourceValues),
  complexity: z.enum(taskComplexityValues),
  status: z.enum(contributionTaskStatusValues),
  tokensUsed: z.number().int().nonnegative(),
  duration: z.number().nonnegative(),
  filesChanged: z.array(z.string().min(1)),
  pr: z
    .object({
      number: z.number().int().positive(),
      url: z.string().url(),
      status: z.enum(["open", "merged", "closed"]),
    })
    .optional(),
  linkedIssue: z
    .object({
      number: z.number().int().positive(),
      url: z.string().url(),
    })
    .optional(),
  error: z.string().min(1).optional(),
});

export const contributionLogSchema = z.object({
  version: z.literal("1.0"),
  runId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  contributor: z.object({
    githubUsername: githubUsernameSchema,
    email: z.string().email().optional(),
  }),
  repo: z.object({
    fullName: z
      .string()
      .min(1)
      .regex(/^[^\s/]+\/[^\s/]+$/, "Expected repository in owner/repo format."),
    headSha: z.string().regex(/^[A-Fa-f0-9]{7,40}$/, "Expected git SHA (7-40 hex chars)."),
    defaultBranch: z.string().min(1),
  }),
  budget: z.object({
    provider: z.string().min(1),
    totalTokensBudgeted: z.number().int().nonnegative(),
    totalTokensUsed: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().optional(),
  }),
  tasks: z.array(contributionTaskSchema),
  metrics: z.object({
    tasksDiscovered: z.number().int().nonnegative(),
    tasksAttempted: z.number().int().nonnegative(),
    tasksSucceeded: z.number().int().nonnegative(),
    tasksFailed: z.number().int().nonnegative(),
    totalDuration: z.number().nonnegative(),
    totalFilesChanged: z.number().int().nonnegative(),
    totalLinesAdded: z.number().int().nonnegative(),
    totalLinesRemoved: z.number().int().nonnegative(),
  }),
});

export type ContributionTask = z.infer<typeof contributionTaskSchema>;
export type ContributionLog = z.infer<typeof contributionLogSchema>;

export function parseContributionLog(input: unknown): ContributionLog {
  return contributionLogSchema.parse(input);
}
