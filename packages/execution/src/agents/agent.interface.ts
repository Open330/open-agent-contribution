import type {
  AgentProviderId,
  ExecutionResult,
  TokenEstimate,
} from '@oac/core';

export interface AgentAvailability {
  available: boolean;
  version?: string;
  error?: string;
  remainingBudget?: number;
}

export interface AgentExecuteParams {
  executionId: string;
  workingDirectory: string;
  prompt: string;
  targetFiles: string[];
  tokenBudget: number;
  allowCommits: boolean;
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface TokenEstimateParams {
  taskId: string;
  prompt: string;
  targetFiles: string[];
  contextTokens?: number;
  expectedOutputTokens?: number;
}

export type AgentEvent =
  | {
      type: 'output';
      content: string;
      stream: 'stdout' | 'stderr';
    }
  | {
      type: 'tokens';
      inputTokens: number;
      outputTokens: number;
      cumulativeTokens: number;
    }
  | {
      type: 'file_edit';
      path: string;
      action: 'create' | 'modify' | 'delete';
    }
  | {
      type: 'tool_use';
      tool: string;
      input: unknown;
    }
  | {
      type: 'error';
      message: string;
      recoverable: boolean;
    };

export interface AgentResult extends ExecutionResult {}

export interface AgentExecution {
  readonly executionId: string;
  readonly providerId: AgentProviderId;
  events: AsyncIterable<AgentEvent>;
  result: Promise<AgentResult>;
  pid?: number;
}

export interface AgentProvider {
  readonly id: AgentProviderId;
  readonly name: string;
  checkAvailability(): Promise<AgentAvailability>;
  execute(params: AgentExecuteParams): AgentExecution;
  estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate>;
  abort(executionId: string): Promise<void>;
}
