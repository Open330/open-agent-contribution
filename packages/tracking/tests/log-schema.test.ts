import { describe, it, expect } from 'vitest';

import {
  contributionLogSchema,
  contributionTaskSchema,
  parseContributionLog,
} from '../src/log-schema.js';
import type { ContributionLog } from '../src/log-schema.js';

function makeValidLog(overrides: Partial<ContributionLog> = {}): ContributionLog {
  return {
    version: '1.0',
    runId: 'run-abc-123',
    timestamp: '2026-01-15T10:30:00+00:00',
    contributor: {
      githubUsername: 'testuser',
      email: 'test@example.com',
    },
    repo: {
      fullName: 'owner/repo',
      headSha: 'abc1234def5678',
      defaultBranch: 'main',
    },
    budget: {
      provider: 'claude-code',
      totalTokensBudgeted: 100_000,
      totalTokensUsed: 50_000,
    },
    tasks: [
      {
        taskId: 'task-1',
        title: 'Fix lint warning',
        source: 'lint',
        complexity: 'trivial',
        status: 'success',
        tokensUsed: 5_000,
        duration: 30,
        filesChanged: ['src/file.ts'],
      },
    ],
    metrics: {
      tasksDiscovered: 10,
      tasksAttempted: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      totalDuration: 30,
      totalFilesChanged: 1,
      totalLinesAdded: 5,
      totalLinesRemoved: 2,
    },
    ...overrides,
  };
}

describe('valid ContributionLog passes validation', () => {
  it('validates a minimal valid log', () => {
    const log = makeValidLog();
    const result = contributionLogSchema.safeParse(log);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.0');
      expect(result.data.runId).toBe('run-abc-123');
      expect(result.data.contributor.githubUsername).toBe('testuser');
    }
  });

  it('validates a log with empty tasks array', () => {
    const log = makeValidLog({ tasks: [] });
    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(true);
  });

  it('validates a log with pr and linkedIssue on a task', () => {
    const log = makeValidLog({
      tasks: [
        {
          taskId: 'task-1',
          title: 'Fix bug',
          source: 'github-issue',
          complexity: 'moderate',
          status: 'success',
          tokensUsed: 20_000,
          duration: 120,
          filesChanged: ['src/a.ts', 'src/b.ts'],
          pr: {
            number: 42,
            url: 'https://github.com/owner/repo/pull/42',
            status: 'merged',
          },
          linkedIssue: {
            number: 10,
            url: 'https://github.com/owner/repo/issues/10',
          },
        },
      ],
    });

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(true);
  });

  it('validates a log with a failed task including an error string', () => {
    const log = makeValidLog({
      tasks: [
        {
          taskId: 'task-fail',
          title: 'Broken task',
          source: 'todo',
          complexity: 'complex',
          status: 'failed',
          tokensUsed: 10_000,
          duration: 60,
          filesChanged: [],
          error: 'Agent timed out',
        },
      ],
    });

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(true);
  });

  it('accepts all valid task sources', () => {
    const sources = [
      'lint',
      'todo',
      'test-gap',
      'dead-code',
      'github-issue',
      'github-pr-review',
      'custom',
    ] as const;

    for (const source of sources) {
      const log = makeValidLog({
        tasks: [
          {
            taskId: `task-${source}`,
            title: `Task from ${source}`,
            source,
            complexity: 'simple',
            status: 'success',
            tokensUsed: 1_000,
            duration: 10,
            filesChanged: ['src/x.ts'],
          },
        ],
      });

      const result = contributionLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid complexity values', () => {
    const complexities = ['trivial', 'simple', 'moderate', 'complex'] as const;

    for (const complexity of complexities) {
      const log = makeValidLog({
        tasks: [
          {
            taskId: `task-${complexity}`,
            title: `Task ${complexity}`,
            source: 'lint',
            complexity,
            status: 'success',
            tokensUsed: 1_000,
            duration: 10,
            filesChanged: [],
          },
        ],
      });

      const result = contributionLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional estimatedCostUsd in budget', () => {
    const log = makeValidLog({
      budget: {
        provider: 'claude-code',
        totalTokensBudgeted: 100_000,
        totalTokensUsed: 50_000,
        estimatedCostUsd: 1.23,
      },
    });

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budget.estimatedCostUsd).toBe(1.23);
    }
  });

  it('parseContributionLog returns parsed data for valid input', () => {
    const log = makeValidLog();
    const parsed = parseContributionLog(log);

    expect(parsed.version).toBe('1.0');
    expect(parsed.runId).toBe('run-abc-123');
  });
});

describe('invalid data fails validation', () => {
  it('rejects a log with wrong version', () => {
    const log = makeValidLog();
    (log as Record<string, unknown>).version = '2.0';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with missing runId', () => {
    const log = makeValidLog();
    delete (log as Record<string, unknown>).runId;

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid timestamp format', () => {
    const log = makeValidLog();
    (log as Record<string, unknown>).timestamp = 'not-a-date';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid GitHub username', () => {
    const log = makeValidLog();
    log.contributor.githubUsername = '-invalid-username-';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid repo fullName format', () => {
    const log = makeValidLog();
    log.repo.fullName = 'just-a-name-no-slash';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid headSha', () => {
    const log = makeValidLog();
    log.repo.headSha = 'not-hex!';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with negative tokensUsed in task', () => {
    const log = makeValidLog();
    log.tasks[0].tokensUsed = -100;

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid task source', () => {
    const log = makeValidLog();
    (log.tasks[0] as Record<string, unknown>).source = 'nonexistent-source';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with invalid task status', () => {
    const log = makeValidLog();
    (log.tasks[0] as Record<string, unknown>).status = 'unknown-status';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a log with negative metric values', () => {
    const log = makeValidLog();
    log.metrics.tasksDiscovered = -1;

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('parseContributionLog throws for invalid input', () => {
    expect(() => parseContributionLog({})).toThrow();
    expect(() => parseContributionLog(null)).toThrow();
    expect(() => parseContributionLog('string')).toThrow();
  });

  it('rejects a completely empty object', () => {
    const result = contributionLogSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email format', () => {
    const log = makeValidLog();
    log.contributor.email = 'not-an-email';

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects a PR with invalid url', () => {
    const log = makeValidLog({
      tasks: [
        {
          taskId: 'task-1',
          title: 'Fix',
          source: 'lint',
          complexity: 'trivial',
          status: 'success',
          tokensUsed: 1_000,
          duration: 10,
          filesChanged: [],
          pr: {
            number: 1,
            url: 'not-a-url',
            status: 'open',
          },
        },
      ],
    });

    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });
});

describe('schema version', () => {
  it('only accepts version "1.0"', () => {
    const validLog = makeValidLog();
    const result = contributionLogSchema.safeParse(validLog);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.0');
    }
  });

  it('rejects version "1.1"', () => {
    const log = makeValidLog();
    (log as Record<string, unknown>).version = '1.1';
    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects numeric version 1.0', () => {
    const log = makeValidLog();
    (log as Record<string, unknown>).version = 1.0;
    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });

  it('rejects missing version', () => {
    const log = makeValidLog();
    delete (log as Record<string, unknown>).version;
    const result = contributionLogSchema.safeParse(log);
    expect(result.success).toBe(false);
  });
});
