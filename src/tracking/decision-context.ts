import { z } from "zod";

// ── Decision Context Schema ─────────────────────────────────

export const alternativeTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
});

export const goalAlignmentSchema = z.object({
  missionStatement: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  goalId: z.string().min(1).optional(),
  goalTitle: z.string().min(1).optional(),
});

export const budgetConsiderationsSchema = z.object({
  estimatedCost: z.number().nonnegative(),
  remainingBudget: z.number().nonnegative(),
  priorityScore: z.number(),
});

export const decisionContextSchema = z.object({
  taskSelectionReason: z.string().min(1),
  alternativeTasks: z.array(alternativeTaskSchema),
  goalAlignment: goalAlignmentSchema.optional(),
  budgetConsiderations: budgetConsiderationsSchema,
  timestamp: z.string().datetime({ offset: true }),
});

export type AlternativeTask = z.infer<typeof alternativeTaskSchema>;
export type GoalAlignment = z.infer<typeof goalAlignmentSchema>;
export type BudgetConsiderations = z.infer<typeof budgetConsiderationsSchema>;
export type DecisionContext = z.infer<typeof decisionContextSchema>;

// ── Builder ─────────────────────────────────────────────────

export interface BuildDecisionContextOptions {
  taskSelectionReason: string;
  alternativeTasks: AlternativeTask[];
  goalAlignment?: GoalAlignment;
  budgetConsiderations: BudgetConsiderations;
}

/**
 * Build and validate a DecisionContext, automatically adding the current
 * timestamp. Returns a frozen, immutable object.
 */
export function buildDecisionContext(options: BuildDecisionContextOptions): DecisionContext {
  const context: DecisionContext = {
    taskSelectionReason: options.taskSelectionReason,
    alternativeTasks: options.alternativeTasks,
    goalAlignment: options.goalAlignment,
    budgetConsiderations: options.budgetConsiderations,
    timestamp: new Date().toISOString(),
  };

  // Validate against schema before returning.
  const parsed = decisionContextSchema.parse(context);

  return Object.freeze(parsed) as DecisionContext;
}
