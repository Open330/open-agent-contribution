import { z } from "zod";

// ── Mission / Goal Schemas ───────────────────────────────────

export const OrganizationMissionSchema = z
  .object({
    statement: z.string().min(1),
  })
  .strict();

export const OrganizationGoalSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.number().int().min(0).max(100).default(50),
  })
  .strict();

export const OrganizationProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    repos: z.array(z.string().min(1)).default([]),
    goals: z.array(OrganizationGoalSchema).default([]),
  })
  .strict();

// ── Agent Role Schemas ───────────────────────────────────────

export const AgentRoleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    agent: z.string().min(1).default("claude-code"),
    repos: z.array(z.string().min(1)).default([]),
    taskSources: z
      .array(z.enum(["lint", "test-gap", "dead-code", "github-issue", "custom"]))
      .optional(),
    systemPrompt: z.string().min(1).optional(),
  })
  .strict();

// ── Combined Organization Schema ─────────────────────────────

export const OrganizationSchema = z
  .object({
    mission: OrganizationMissionSchema.optional(),
    projects: z.array(OrganizationProjectSchema).default([]),
    roles: z.array(AgentRoleSchema).default([]),
  })
  .strict()
  .default({});

export type OrganizationSchemaInput = z.input<typeof OrganizationSchema>;
export type OrganizationSchemaOutput = z.output<typeof OrganizationSchema>;
