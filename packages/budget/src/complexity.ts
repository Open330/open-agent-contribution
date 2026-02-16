import type { Task, TaskComplexity, TaskSource } from './estimator.js';

const SOURCE_LOC_BASELINE: Record<TaskSource, number> = {
  lint: 8,
  todo: 16,
  'test-gap': 48,
  'dead-code': 36,
  'github-issue': 88,
  'github-pr-review': 56,
  custom: 40,
};

const SOURCE_COMPLEXITY_SCORE: Record<TaskSource, number> = {
  lint: 0,
  todo: 0,
  'test-gap': 1,
  'dead-code': 1,
  'github-issue': 2,
  'github-pr-review': 2,
  custom: 1,
};

const ESTIMATED_LOC_KEYS = [
  'estimatedLoc',
  'estimatedLOC',
  'estimatedLocChanges',
  'estimatedDiffSize',
  'loc',
  'locChanges',
  'linesChanged',
  'lineCount',
  'diffSize',
  'changeSize',
] as const;

function parseNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

function readMetadataLocEstimate(metadata: Record<string, unknown>): number | undefined {
  for (const key of ESTIMATED_LOC_KEYS) {
    const directValue = parseNumericValue(metadata[key]);
    if (directValue !== undefined) {
      return directValue;
    }
  }

  const metrics = metadata.metrics;
  if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
    const metricsRecord = metrics as Record<string, unknown>;
    for (const key of ESTIMATED_LOC_KEYS) {
      const metricValue = parseNumericValue(metricsRecord[key]);
      if (metricValue !== undefined) {
        return metricValue;
      }
    }
  }

  return undefined;
}

export function estimateLocChanges(task: Task): number {
  const metadataEstimate = readMetadataLocEstimate(task.metadata);
  if (metadataEstimate !== undefined) {
    return Math.max(1, Math.round(metadataEstimate));
  }

  const sourceBaseline = SOURCE_LOC_BASELINE[task.source] ?? SOURCE_LOC_BASELINE.custom;
  const fileAdjustment = Math.max(task.targetFiles.length, 1) * 8;

  return Math.max(sourceBaseline, fileAdjustment);
}

export function analyzeTaskComplexity(task: Task): TaskComplexity {
  const fileCount = task.targetFiles.length;
  const locChanges = estimateLocChanges(task);

  const fileScore = fileCount <= 1 ? 0 : fileCount <= 3 ? 1 : fileCount <= 6 ? 2 : 3;
  const locScore = locChanges <= 20 ? 0 : locChanges <= 80 ? 1 : locChanges <= 200 ? 2 : 3;
  const sourceScore = SOURCE_COMPLEXITY_SCORE[task.source] ?? SOURCE_COMPLEXITY_SCORE.custom;

  const totalScore = fileScore + locScore + sourceScore;

  if (totalScore <= 1) {
    return 'trivial';
  }

  if (totalScore <= 3) {
    return 'simple';
  }

  if (totalScore <= 6) {
    return 'moderate';
  }

  return 'complex';
}
