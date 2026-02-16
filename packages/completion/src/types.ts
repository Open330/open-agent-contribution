import type { ExecutionResult, ResolvedRepo, Task } from '@oac/core';

export interface PRCreationParams {
  repo: ResolvedRepo;
  task: Task;
  result: ExecutionResult;
  branchName: string;
  baseBranch: string;
}

export interface CreatedPR {
  number: number;
  url: string;
  sha: string;
}

export interface CompletionResult {
  prUrl?: string;
  commitSha?: string;
  summary: string;
  filesChanged: number;
  tokensUsed: number;
}

export interface ExternalTaskRef {
  provider: string;
  externalId: string;
  url?: string;
}

export interface ProjectManagementProvider {
  readonly id: string;
  readonly name: string;
  ping(): Promise<boolean>;
  notifyStarted(ref: ExternalTaskRef): Promise<void>;
  notifyPRCreated(ref: ExternalTaskRef, prUrl: string): Promise<void>;
  notifyCompleted(ref: ExternalTaskRef, result: CompletionResult): Promise<void>;
  notifyFailed(ref: ExternalTaskRef, error: string): Promise<void>;
}
