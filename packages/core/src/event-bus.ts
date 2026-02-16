import EventEmitter from 'eventemitter3';

import type { OacError } from './errors.js';
import type {
  ExecutionResult,
  ResolvedRepo,
  RunSummary,
  Task,
  TokenEstimate,
} from './types.js';

export interface OacEvents {
  'repo:resolved': { repo: ResolvedRepo };
  'task:discovered': { tasks: Task[] };
  'task:selected': { task: Task; reason: string };
  'budget:estimated': { task: Task; estimate: TokenEstimate };
  'execution:started': { jobId: string; task: Task; agent: string };
  'execution:progress': { jobId: string; tokensUsed: number; stage: string };
  'execution:completed': { jobId: string; result: ExecutionResult };
  'execution:failed': { jobId: string; error: OacError };
  'pr:created': { jobId: string; prUrl: string };
  'pr:merged': { jobId: string; prUrl: string };
  'run:completed': { summary: RunSummary };
}

type OacEventArgs = {
  [K in keyof OacEvents]: [payload: OacEvents[K]];
};

export type OacEventBus = EventEmitter<OacEventArgs>;

export function createEventBus(): OacEventBus {
  return new EventEmitter<OacEventArgs>();
}
