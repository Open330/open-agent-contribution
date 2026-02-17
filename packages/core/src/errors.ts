export type OacErrorSeverity = "fatal" | "recoverable" | "warning";

export const REPO_ERROR_CODES = [
  "REPO_NOT_FOUND",
  "REPO_ARCHIVED",
  "REPO_NO_PERMISSION",
  "REPO_CLONE_FAILED",
] as const;

export const DISCOVERY_ERROR_CODES = [
  "SCANNER_FAILED",
  "SCANNER_TIMEOUT",
  "NO_TASKS_FOUND",
] as const;

export const BUDGET_ERROR_CODES = ["BUDGET_INSUFFICIENT", "TOKENIZER_UNAVAILABLE"] as const;

export const EXECUTION_ERROR_CODES = [
  "AGENT_NOT_AVAILABLE",
  "AGENT_EXECUTION_FAILED",
  "AGENT_TIMEOUT",
  "AGENT_OOM",
  "AGENT_TOKEN_LIMIT",
  "AGENT_RATE_LIMITED",
  "VALIDATION_LINT_FAILED",
  "VALIDATION_TEST_FAILED",
  "VALIDATION_DIFF_TOO_LARGE",
  "VALIDATION_FORBIDDEN_PATTERN",
] as const;

export const COMPLETION_ERROR_CODES = [
  "PR_CREATION_FAILED",
  "PR_PUSH_REJECTED",
  "WEBHOOK_DELIVERY_FAILED",
] as const;

export const CONFIG_ERROR_CODES = ["CONFIG_INVALID", "CONFIG_SECRET_MISSING"] as const;

export const SYSTEM_ERROR_CODES = ["NETWORK_ERROR", "DISK_SPACE_LOW", "GIT_LOCK_FAILED"] as const;

export const OAC_ERROR_CODES = [
  ...REPO_ERROR_CODES,
  ...DISCOVERY_ERROR_CODES,
  ...BUDGET_ERROR_CODES,
  ...EXECUTION_ERROR_CODES,
  ...COMPLETION_ERROR_CODES,
  ...CONFIG_ERROR_CODES,
  ...SYSTEM_ERROR_CODES,
] as const;

export type RepoErrorCode = (typeof REPO_ERROR_CODES)[number];
export type DiscoveryErrorCode = (typeof DISCOVERY_ERROR_CODES)[number];
export type BudgetErrorCode = (typeof BUDGET_ERROR_CODES)[number];
export type ExecutionErrorCode = (typeof EXECUTION_ERROR_CODES)[number];
export type CompletionErrorCode = (typeof COMPLETION_ERROR_CODES)[number];
export type ConfigErrorCode = (typeof CONFIG_ERROR_CODES)[number];
export type SystemErrorCode = (typeof SYSTEM_ERROR_CODES)[number];
export type OacErrorCode = (typeof OAC_ERROR_CODES)[number];

export interface OacErrorOptions {
  severity?: OacErrorSeverity;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export class OacError extends Error {
  public readonly code: OacErrorCode;
  public readonly severity: OacErrorSeverity;
  public readonly context?: Record<string, unknown>;
  public override readonly cause?: unknown;

  public constructor(
    message: string,
    code: OacErrorCode,
    severity: OacErrorSeverity,
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.name = "OacError";
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.cause = cause;
  }
}

function createError(
  code: OacErrorCode,
  message: string,
  defaultSeverity: OacErrorSeverity,
  options: OacErrorOptions = {},
): OacError {
  return new OacError(
    message,
    code,
    options.severity ?? defaultSeverity,
    options.context,
    options.cause,
  );
}

export function repoError(
  code: RepoErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "fatal", options);
}

export function discoveryError(
  code: DiscoveryErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "recoverable", options);
}

export function budgetError(
  code: BudgetErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "recoverable", options);
}

export function executionError(
  code: ExecutionErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "recoverable", options);
}

export function completionError(
  code: CompletionErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "recoverable", options);
}

export function configError(
  code: ConfigErrorCode,
  message: string,
  options: OacErrorOptions = {},
): OacError {
  return createError(code, message, "fatal", options);
}
