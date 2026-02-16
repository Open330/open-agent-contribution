export type AgentProviderId =
  | 'claude-code'
  | 'codex-cli'
  | 'opencode'
  | (string & {});

export interface ResolvedRepo {
  fullName: string;
  owner: string;
  name: string;
  localPath: string;
  worktreePath: string;
  meta: {
    defaultBranch: string;
    language?: string;
    languages: Record<string, number>;
    size: number;
    stars: number;
    openIssuesCount: number;
    topics: string[];
    license?: string;
    isArchived: boolean;
    isFork: boolean;
    permissions: {
      admin: boolean;
      maintain: boolean;
      push: boolean;
      triage: boolean;
      pull: boolean;
    };
  };
  git: {
    headSha: string;
    remoteUrl: string;
    isShallowClone: boolean;
  };
}

export type TaskSource =
  | 'lint'
  | 'todo'
  | 'test-gap'
  | 'dead-code'
  | 'github-issue'
  | 'custom';

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export type ExecutionMode = 'new-pr' | 'update-pr' | 'direct-commit';

export interface Task {
  id: string;
  source: TaskSource;
  title: string;
  description: string;
  targetFiles: string[];
  priority: number;
  complexity: TaskComplexity;
  executionMode: ExecutionMode;
  linkedIssue?: {
    number: number;
    url: string;
    labels: string[];
  };
  metadata: Record<string, unknown>;
  discoveredAt: string;
}

export interface TokenEstimate {
  taskId: string;
  providerId: AgentProviderId;
  contextTokens: number;
  promptTokens: number;
  expectedOutputTokens: number;
  totalEstimatedTokens: number;
  confidence: number;
  feasible: boolean;
  estimatedCostUsd?: number;
}

export interface ExecutionPlan {
  totalBudget: number;
  selectedTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    cumulativeBudgetUsed: number;
  }>;
  deferredTasks: Array<{
    task: Task;
    estimate: TokenEstimate;
    reason: 'budget_exceeded' | 'low_confidence' | 'too_complex';
  }>;
  reserveTokens: number;
  remainingTokens: number;
}

export interface ContributionTask {
  taskId: string;
  title: string;
  source: TaskSource;
  complexity: TaskComplexity;
  status: 'success' | 'partial' | 'failed';
  tokensUsed: number;
  duration: number;
  filesChanged: string[];
  pr?: {
    number: number;
    url: string;
    status: 'open' | 'merged' | 'closed';
  };
  linkedIssue?: {
    number: number;
    url: string;
  };
  error?: string;
}

export interface ContributionLog {
  version: '1.0';
  runId: string;
  timestamp: string;
  contributor: {
    githubUsername: string;
    email?: string;
  };
  repo: {
    fullName: string;
    headSha: string;
    defaultBranch: string;
  };
  budget: {
    provider: AgentProviderId;
    totalTokensBudgeted: number;
    totalTokensUsed: number;
    estimatedCostUsd?: number;
  };
  tasks: ContributionTask[];
  metrics: {
    tasksDiscovered: number;
    tasksAttempted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    totalDuration: number;
    totalFilesChanged: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  totalTokensUsed: number;
  filesChanged: string[];
  duration: number;
  error?: string;
}

export interface RunSummary {
  runId: string;
  repo: string;
  provider: AgentProviderId;
  startedAt: string;
  completedAt: string;
  duration: number;
  budget: {
    totalTokens: number;
    reserveTokens: number;
    usedTokens: number;
    remainingTokens: number;
    estimatedCostUsd?: number;
  };
  tasks: {
    discovered: number;
    selected: number;
    attempted: number;
    succeeded: number;
    failed: number;
    deferred: number;
  };
  pullRequests: {
    created: number;
    merged: number;
    urls: string[];
  };
}
