import { describe, expect, it } from "vitest";

import {
  BUDGET_ERROR_CODES,
  COMPLETION_ERROR_CODES,
  CONFIG_ERROR_CODES,
  DISCOVERY_ERROR_CODES,
  EXECUTION_ERROR_CODES,
  OAC_ERROR_CODES,
  OacError,
  REPO_ERROR_CODES,
  SYSTEM_ERROR_CODES,
  budgetError,
  completionError,
  configError,
  discoveryError,
  executionError,
  repoError,
} from "../../src/core/errors.js";

describe("OacError creation", () => {
  it("creates an error with code, severity, and context", () => {
    const error = new OacError("Repository not found", "REPO_NOT_FOUND", "fatal", {
      repoName: "owner/repo",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OacError);
    expect(error.message).toBe("Repository not found");
    expect(error.code).toBe("REPO_NOT_FOUND");
    expect(error.severity).toBe("fatal");
    expect(error.context).toEqual({ repoName: "owner/repo" });
    expect(error.name).toBe("OacError");
  });

  it("creates an error with a cause", () => {
    const cause = new Error("network timeout");
    const error = new OacError("Clone failed", "REPO_CLONE_FAILED", "fatal", undefined, cause);

    expect(error.cause).toBe(cause);
    expect(error.context).toBeUndefined();
  });

  it("creates an error without optional fields", () => {
    const error = new OacError("Budget insufficient", "BUDGET_INSUFFICIENT", "recoverable");

    expect(error.code).toBe("BUDGET_INSUFFICIENT");
    expect(error.severity).toBe("recoverable");
    expect(error.context).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("can be caught as a standard Error", () => {
    const error = new OacError("test", "NETWORK_ERROR", "warning");

    expect(() => {
      throw error;
    }).toThrow(Error);
  });
});

describe("error factory functions", () => {
  describe("repoError", () => {
    it('creates an error with default severity "fatal"', () => {
      const error = repoError("REPO_NOT_FOUND", "Not found");
      expect(error.code).toBe("REPO_NOT_FOUND");
      expect(error.severity).toBe("fatal");
      expect(error).toBeInstanceOf(OacError);
    });

    it("allows overriding default severity", () => {
      const error = repoError("REPO_ARCHIVED", "Archived", {
        severity: "warning",
      });
      expect(error.severity).toBe("warning");
    });

    it("attaches context and cause", () => {
      const cause = new Error("original");
      const error = repoError("REPO_NO_PERMISSION", "No permission", {
        context: { repo: "owner/repo" },
        cause,
      });
      expect(error.context).toEqual({ repo: "owner/repo" });
      expect(error.cause).toBe(cause);
    });
  });

  describe("discoveryError", () => {
    it('creates an error with default severity "recoverable"', () => {
      const error = discoveryError("SCANNER_FAILED", "Scanner crashed");
      expect(error.code).toBe("SCANNER_FAILED");
      expect(error.severity).toBe("recoverable");
    });

    it("supports SCANNER_TIMEOUT code", () => {
      const error = discoveryError("SCANNER_TIMEOUT", "Timed out");
      expect(error.code).toBe("SCANNER_TIMEOUT");
    });

    it("supports NO_TASKS_FOUND code", () => {
      const error = discoveryError("NO_TASKS_FOUND", "Nothing to do");
      expect(error.code).toBe("NO_TASKS_FOUND");
    });
  });

  describe("budgetError", () => {
    it("creates a recoverable error by default", () => {
      const error = budgetError("BUDGET_INSUFFICIENT", "Not enough tokens");
      expect(error.code).toBe("BUDGET_INSUFFICIENT");
      expect(error.severity).toBe("recoverable");
    });

    it("supports TOKENIZER_UNAVAILABLE code", () => {
      const error = budgetError("TOKENIZER_UNAVAILABLE", "No tokenizer");
      expect(error.code).toBe("TOKENIZER_UNAVAILABLE");
      expect(error.severity).toBe("recoverable");
    });
  });

  describe("executionError", () => {
    it("creates a recoverable error by default", () => {
      const error = executionError("AGENT_NOT_AVAILABLE", "Agent down");
      expect(error.code).toBe("AGENT_NOT_AVAILABLE");
      expect(error.severity).toBe("recoverable");
    });

    it("supports all execution error codes", () => {
      const codes = [
        "AGENT_EXECUTION_FAILED",
        "AGENT_TIMEOUT",
        "AGENT_OOM",
        "AGENT_TOKEN_LIMIT",
        "VALIDATION_LINT_FAILED",
        "VALIDATION_TEST_FAILED",
        "VALIDATION_DIFF_TOO_LARGE",
        "VALIDATION_FORBIDDEN_PATTERN",
      ] as const;

      for (const code of codes) {
        const error = executionError(code, `Error: ${code}`);
        expect(error.code).toBe(code);
        expect(error).toBeInstanceOf(OacError);
      }
    });
  });

  describe("completionError", () => {
    it("creates a recoverable error by default", () => {
      const error = completionError("PR_CREATION_FAILED", "PR failed");
      expect(error.code).toBe("PR_CREATION_FAILED");
      expect(error.severity).toBe("recoverable");
    });

    it("supports PR_PUSH_REJECTED code", () => {
      const error = completionError("PR_PUSH_REJECTED", "Push rejected");
      expect(error.code).toBe("PR_PUSH_REJECTED");
    });

    it("supports WEBHOOK_DELIVERY_FAILED code", () => {
      const error = completionError("WEBHOOK_DELIVERY_FAILED", "Webhook failed");
      expect(error.code).toBe("WEBHOOK_DELIVERY_FAILED");
    });
  });

  describe("configError", () => {
    it("creates a fatal error by default", () => {
      const error = configError("CONFIG_INVALID", "Bad config");
      expect(error.code).toBe("CONFIG_INVALID");
      expect(error.severity).toBe("fatal");
    });

    it("supports CONFIG_SECRET_MISSING code", () => {
      const error = configError("CONFIG_SECRET_MISSING", "Missing secret", {
        context: { variableName: "API_KEY" },
      });
      expect(error.code).toBe("CONFIG_SECRET_MISSING");
      expect(error.context?.variableName).toBe("API_KEY");
    });
  });
});

describe("error codes", () => {
  it("REPO_ERROR_CODES contains expected codes", () => {
    expect(REPO_ERROR_CODES).toContain("REPO_NOT_FOUND");
    expect(REPO_ERROR_CODES).toContain("REPO_ARCHIVED");
    expect(REPO_ERROR_CODES).toContain("REPO_NO_PERMISSION");
    expect(REPO_ERROR_CODES).toContain("REPO_CLONE_FAILED");
    expect(REPO_ERROR_CODES).toHaveLength(4);
  });

  it("DISCOVERY_ERROR_CODES contains expected codes", () => {
    expect(DISCOVERY_ERROR_CODES).toContain("SCANNER_FAILED");
    expect(DISCOVERY_ERROR_CODES).toContain("SCANNER_TIMEOUT");
    expect(DISCOVERY_ERROR_CODES).toContain("NO_TASKS_FOUND");
    expect(DISCOVERY_ERROR_CODES).toHaveLength(3);
  });

  it("BUDGET_ERROR_CODES contains expected codes", () => {
    expect(BUDGET_ERROR_CODES).toContain("BUDGET_INSUFFICIENT");
    expect(BUDGET_ERROR_CODES).toContain("TOKENIZER_UNAVAILABLE");
    expect(BUDGET_ERROR_CODES).toHaveLength(2);
  });

  it("EXECUTION_ERROR_CODES contains expected codes", () => {
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_NOT_AVAILABLE");
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_EXECUTION_FAILED");
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_TIMEOUT");
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_OOM");
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_TOKEN_LIMIT");
    expect(EXECUTION_ERROR_CODES).toContain("AGENT_RATE_LIMITED");
    expect(EXECUTION_ERROR_CODES).toContain("VALIDATION_LINT_FAILED");
    expect(EXECUTION_ERROR_CODES).toContain("VALIDATION_TEST_FAILED");
    expect(EXECUTION_ERROR_CODES).toContain("VALIDATION_DIFF_TOO_LARGE");
    expect(EXECUTION_ERROR_CODES).toContain("VALIDATION_FORBIDDEN_PATTERN");
    expect(EXECUTION_ERROR_CODES).toHaveLength(10);
  });

  it("COMPLETION_ERROR_CODES contains expected codes", () => {
    expect(COMPLETION_ERROR_CODES).toContain("PR_CREATION_FAILED");
    expect(COMPLETION_ERROR_CODES).toContain("PR_PUSH_REJECTED");
    expect(COMPLETION_ERROR_CODES).toContain("WEBHOOK_DELIVERY_FAILED");
    expect(COMPLETION_ERROR_CODES).toHaveLength(3);
  });

  it("CONFIG_ERROR_CODES contains expected codes", () => {
    expect(CONFIG_ERROR_CODES).toContain("CONFIG_INVALID");
    expect(CONFIG_ERROR_CODES).toContain("CONFIG_SECRET_MISSING");
    expect(CONFIG_ERROR_CODES).toHaveLength(2);
  });

  it("SYSTEM_ERROR_CODES contains expected codes", () => {
    expect(SYSTEM_ERROR_CODES).toContain("NETWORK_ERROR");
    expect(SYSTEM_ERROR_CODES).toContain("DISK_SPACE_LOW");
    expect(SYSTEM_ERROR_CODES).toContain("GIT_LOCK_FAILED");
    expect(SYSTEM_ERROR_CODES).toHaveLength(3);
  });

  it("OAC_ERROR_CODES is the union of all category code arrays", () => {
    const expectedLength =
      REPO_ERROR_CODES.length +
      DISCOVERY_ERROR_CODES.length +
      BUDGET_ERROR_CODES.length +
      EXECUTION_ERROR_CODES.length +
      COMPLETION_ERROR_CODES.length +
      CONFIG_ERROR_CODES.length +
      SYSTEM_ERROR_CODES.length;

    expect(OAC_ERROR_CODES).toHaveLength(expectedLength);

    for (const code of REPO_ERROR_CODES) {
      expect(OAC_ERROR_CODES).toContain(code);
    }
    for (const code of DISCOVERY_ERROR_CODES) {
      expect(OAC_ERROR_CODES).toContain(code);
    }
    for (const code of CONFIG_ERROR_CODES) {
      expect(OAC_ERROR_CODES).toContain(code);
    }
    for (const code of SYSTEM_ERROR_CODES) {
      expect(OAC_ERROR_CODES).toContain(code);
    }
  });
});
