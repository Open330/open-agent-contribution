import {
  OacError,
  completionError,
  executionError,
  type OacConfig,
  type OacEventBus,
  type ResolvedRepo,
  type Task,
} from '@oac/core';
import type { Octokit } from '@octokit/rest';

import {
  validateDiff,
  type DiffValidationConfig,
  type ValidationResult,
} from './diff-validator.js';
import { createPR, pushBranch } from './github-pr.js';
import { linkIssueToePR } from './issue-linker.js';
import type {
  CompletionResult,
  CreatedPR,
  ExternalTaskRef,
  PRCreationParams,
  ProjectManagementProvider,
} from './types.js';

export interface CompletionHandlerOptions {
  octokit: Octokit;
  eventBus: OacEventBus;
  providers?: ProjectManagementProvider[];
  diffValidationConfig?: DiffValidationConfig | OacConfig;
}

export interface CompletionHandlerParams extends PRCreationParams {
  jobId: string;
  externalTaskRef?: ExternalTaskRef;
  diffValidationConfig?: DiffValidationConfig | OacConfig;
}

export class CompletionHandler {
  private readonly octokit: Octokit;
  private readonly eventBus: OacEventBus;
  private readonly providers: ProjectManagementProvider[];
  private readonly diffValidationConfig?: DiffValidationConfig | OacConfig;

  public constructor(options: CompletionHandlerOptions) {
    this.octokit = options.octokit;
    this.eventBus = options.eventBus;
    this.providers = options.providers ?? [];
    this.diffValidationConfig = options.diffValidationConfig;
  }

  public async handle(params: CompletionHandlerParams): Promise<CompletionResult> {
    return this.complete(params);
  }

  public async complete(params: CompletionHandlerParams): Promise<CompletionResult> {
    const warnings: string[] = [];
    const externalTaskRef = this.resolveExternalTaskRef(
      params.task,
      params.externalTaskRef,
    );

    try {
      this.emitProgress(params.jobId, params.result.totalTokensUsed, 'completion:validateDiff');
      const validation = await validateDiff(
        resolveRepoPath(params.repo),
        params.diffValidationConfig ?? this.diffValidationConfig,
      );
      this.handleValidationResult(validation);
      warnings.push(...validation.warnings);

      warnings.push(...(await this.notifyStarted(externalTaskRef)));

      this.emitProgress(params.jobId, params.result.totalTokensUsed, 'completion:pushBranch');
      await pushBranch(params.repo, params.branchName);

      this.emitProgress(params.jobId, params.result.totalTokensUsed, 'completion:createPR');
      const pr = await createPR(params, this.octokit);
      this.eventBus.emit('pr:created', { jobId: params.jobId, prUrl: pr.url });

      this.emitProgress(params.jobId, params.result.totalTokensUsed, 'completion:linkIssue');
      const linkIssueWarning = await this.tryLinkIssue(params.repo, params.task, pr);
      if (linkIssueWarning) {
        warnings.push(linkIssueWarning);
      }

      this.emitProgress(params.jobId, params.result.totalTokensUsed, 'completion:notifyWebhooks');
      warnings.push(...(await this.notifyPRCreated(externalTaskRef, pr)));

      const completionResult = buildCompletionResult(params, pr, warnings);
      warnings.push(...(await this.notifyCompleted(externalTaskRef, completionResult)));

      return completionResult;
    } catch (error) {
      const normalizedError = this.normalizePipelineError(error, params);
      this.eventBus.emit('execution:failed', {
        jobId: params.jobId,
        error: normalizedError,
      });
      await this.notifyFailed(externalTaskRef, normalizedError.message);
      throw normalizedError;
    }
  }

  private emitProgress(jobId: string, tokensUsed: number, stage: string): void {
    this.eventBus.emit('execution:progress', {
      jobId,
      tokensUsed,
      stage,
    });
  }

  private handleValidationResult(validation: ValidationResult): void {
    if (validation.valid) {
      return;
    }

    const hasForbiddenPattern = validation.errors.some((message) =>
      message.toLowerCase().includes('forbidden pattern'),
    );
    const errorCode = hasForbiddenPattern
      ? 'VALIDATION_FORBIDDEN_PATTERN'
      : 'VALIDATION_DIFF_TOO_LARGE';

    throw executionError(errorCode, 'Diff validation failed.', {
      context: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
    });
  }

  private async tryLinkIssue(
    repo: ResolvedRepo,
    task: Task,
    pr: CreatedPR,
  ): Promise<string | undefined> {
    try {
      await linkIssueToePR(repo, task, pr, this.octokit);
      return undefined;
    } catch (error) {
      return `Issue linking warning: ${toErrorMessage(error)}`;
    }
  }

  private async notifyStarted(ref: ExternalTaskRef | undefined): Promise<string[]> {
    return this.notifyProviders(ref, 'notifyStarted', (provider, taskRef) =>
      provider.notifyStarted(taskRef),
    );
  }

  private async notifyPRCreated(
    ref: ExternalTaskRef | undefined,
    pr: CreatedPR,
  ): Promise<string[]> {
    return this.notifyProviders(ref, 'notifyPRCreated', (provider, taskRef) =>
      provider.notifyPRCreated(taskRef, pr.url),
    );
  }

  private async notifyCompleted(
    ref: ExternalTaskRef | undefined,
    result: CompletionResult,
  ): Promise<string[]> {
    return this.notifyProviders(ref, 'notifyCompleted', (provider, taskRef) =>
      provider.notifyCompleted(taskRef, result),
    );
  }

  private async notifyFailed(ref: ExternalTaskRef | undefined, message: string): Promise<void> {
    await this.notifyProviders(ref, 'notifyFailed', (provider, taskRef) =>
      provider.notifyFailed(taskRef, message),
    );
  }

  private async notifyProviders(
    ref: ExternalTaskRef | undefined,
    operationName: string,
    operation: (
      provider: ProjectManagementProvider,
      taskRef: ExternalTaskRef,
    ) => Promise<void>,
  ): Promise<string[]> {
    if (!ref) {
      return [];
    }

    const selectedProviders = this.providers.filter(
      (provider) => provider.id === ref.provider,
    );
    if (selectedProviders.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(
      selectedProviders.map(async (provider) => {
        const isReachable = await provider.ping();
        if (!isReachable) {
          throw new Error(`Provider "${provider.id}" is unreachable.`);
        }
        await operation(provider, ref);
      }),
    );

    const warnings: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'fulfilled') {
        continue;
      }

      warnings.push(
        `${operationName} failed for provider "${
          selectedProviders[index].id
        }": ${toErrorMessage(result.reason)}`,
      );
    }

    return warnings;
  }

  private resolveExternalTaskRef(
    task: Task,
    providedRef?: ExternalTaskRef,
  ): ExternalTaskRef | undefined {
    if (providedRef) {
      return providedRef;
    }

    if (task.linkedIssue) {
      return {
        provider: 'github',
        externalId: `#${task.linkedIssue.number}`,
        url: task.linkedIssue.url,
      };
    }

    const metadata = task.metadata as Record<string, unknown>;
    const provider = readMetadataString(metadata, 'externalProvider');
    const externalId = readMetadataString(metadata, 'externalId');
    const url = readMetadataString(metadata, 'externalUrl');

    if (!provider || !externalId) {
      return undefined;
    }

    return { provider, externalId, url };
  }

  private normalizePipelineError(
    error: unknown,
    params: CompletionHandlerParams,
  ): OacError {
    if (error instanceof OacError) {
      return error;
    }

    return completionError(
      'PR_CREATION_FAILED',
      `Completion pipeline failed for task "${params.task.id}" in "${params.repo.fullName}": ${toErrorMessage(
        error,
      )}`,
      {
        cause: error,
        context: {
          jobId: params.jobId,
          taskId: params.task.id,
          repo: params.repo.fullName,
          branchName: params.branchName,
        },
      },
    );
  }
}

function buildCompletionResult(
  params: CompletionHandlerParams,
  pr: CreatedPR,
  warnings: string[],
): CompletionResult {
  const filesChanged = params.result.filesChanged.length;
  const warningSuffix =
    warnings.length > 0 ? ` Completed with ${warnings.length} warning(s).` : '';

  return {
    prUrl: pr.url,
    commitSha: pr.sha,
    summary: `Created PR #${pr.number} for "${params.task.title}".${warningSuffix}`,
    filesChanged,
    tokensUsed: params.result.totalTokensUsed,
  };
}

function resolveRepoPath(repo: ResolvedRepo): string {
  return repo.worktreePath.trim().length > 0 ? repo.worktreePath : repo.localPath;
}

function readMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return 'Unknown error';
}
