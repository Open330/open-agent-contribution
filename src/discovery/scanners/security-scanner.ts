import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { Task, TaskComplexity } from "../../core/index.js";
import type { ScanOptions, Scanner } from "../types.js";

const MAX_SCAN_FILE_SIZE_BYTES = 1_048_576;
const DEFAULT_EXCLUDES = [".git", "node_modules", "dist", "build"] as const;
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb"]);

type SecurityCategory =
  | "hardcoded-secrets"
  | "unsafe-code-execution"
  | "sql-injection"
  | "xss"
  | "insecure-transport";

interface SecurityRule {
  id: string;
  title: string;
  category: SecurityCategory;
  pattern: RegExp;
  priority: number;
  complexity: TaskComplexity;
  summary: string;
  remediation: string;
}

interface SecurityFinding {
  filePath: string;
  line: number;
  column: number;
  matchText: string;
  rule: SecurityRule;
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "hardcoded-api-key",
    title: "Hardcoded API key",
    category: "hardcoded-secrets",
    pattern: /(?:api[_-]?key|apikey)\s*(?::=|[:=])\s*["'][a-zA-Z0-9]{20,}/gi,
    priority: 90,
    complexity: "moderate",
    summary: "A probable API key appears to be hardcoded in source code.",
    remediation:
      "Move secrets to a secure secret manager or environment variables and rotate exposed keys.",
  },
  {
    id: "aws-access-key",
    title: "Hardcoded AWS access key",
    category: "hardcoded-secrets",
    pattern: /AKIA[0-9A-Z]{16}/g,
    priority: 90,
    complexity: "moderate",
    summary: "A probable AWS access key identifier was found in source code.",
    remediation:
      "Remove embedded credentials, rotate the key in AWS IAM, and use temporary credentials.",
  },
  {
    id: "private-key-material",
    title: "Embedded private key material",
    category: "hardcoded-secrets",
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    priority: 90,
    complexity: "moderate",
    summary: "Private key material appears to be present in source code.",
    remediation:
      "Delete committed keys, rotate them immediately, and load key material from secure storage.",
  },
  {
    id: "hardcoded-generic-secret",
    title: "Hardcoded credential value",
    category: "hardcoded-secrets",
    pattern: /(?:secret|password|token|passwd|pwd)\s*(?::=|[:=])\s*["'][^"']{8,}/gi,
    priority: 90,
    complexity: "moderate",
    summary: "A probable credential or token is hardcoded in source code.",
    remediation:
      "Store credentials outside source control and replace hardcoded values with secure configuration.",
  },
  {
    id: "connection-string",
    title: "Exposed database connection string",
    category: "hardcoded-secrets",
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^"'\s]+/gi,
    priority: 90,
    complexity: "moderate",
    summary: "A database connection string appears to be committed in source code.",
    remediation:
      "Remove exposed connection strings, rotate credentials, and inject them from secure configuration.",
  },
  {
    id: "unsafe-eval",
    title: "Use of eval()",
    category: "unsafe-code-execution",
    pattern: /\beval\s*\(/g,
    priority: 70,
    complexity: "complex",
    summary: "Dynamic execution via eval() can enable code injection.",
    remediation:
      "Avoid eval(). Use safe parsers or explicit allow-listed logic for dynamic behavior.",
  },
  {
    id: "unsafe-function-constructor",
    title: "Use of Function constructor",
    category: "unsafe-code-execution",
    pattern: /new\s+Function\s*\(/g,
    priority: 70,
    complexity: "complex",
    summary: "Dynamic code execution via Function constructor can enable injection.",
    remediation: "Replace dynamic function generation with static logic or validated templates.",
  },
  {
    id: "child-process-exec-interpolation",
    title: "Command injection risk in child_process.exec",
    category: "unsafe-code-execution",
    pattern: /\b(?:child_process\.)?(?:exec|execSync)\s*\(\s*`[^`\n]*\$\{[^}\n]+\}[^`\n]*`/g,
    priority: 70,
    complexity: "complex",
    summary: "Executing shell commands with template interpolation can enable command injection.",
    remediation:
      "Use execFile/spawn with argument arrays and strict input validation or allow-lists.",
  },
  {
    id: "sql-template-interpolation",
    title: "Potential SQL injection via template literal",
    category: "sql-injection",
    pattern: /\b(?:query|execute)\s*\(\s*`[^`]*\$\{[^}]+}[^`]*`/g,
    priority: 80,
    complexity: "complex",
    summary: "SQL query construction with interpolation can enable SQL injection.",
    remediation:
      "Use parameterized queries/prepared statements and avoid direct interpolation in SQL strings.",
  },
  {
    id: "sql-string-concatenation",
    title: "Potential SQL injection via string concatenation",
    category: "sql-injection",
    pattern: /\b(?:query|execute)\s*\(\s*(?:["'][^"'`\n]*["']\s*\+|[A-Za-z_$][\w$]*\s*\+)/g,
    priority: 80,
    complexity: "complex",
    summary: "SQL query construction with concatenation can enable SQL injection.",
    remediation:
      "Switch to parameterized queries and separate query templates from untrusted input.",
  },
  {
    id: "inner-html-assignment",
    title: "Potential XSS via innerHTML assignment",
    category: "xss",
    pattern: /\.innerHTML\s*=/g,
    priority: 60,
    complexity: "moderate",
    summary: "Assigning untrusted data to innerHTML can introduce cross-site scripting.",
    remediation: "Use textContent or trusted sanitization before rendering user-controlled HTML.",
  },
  {
    id: "dangerously-set-inner-html",
    title: "Potential XSS via dangerouslySetInnerHTML",
    category: "xss",
    pattern: /dangerouslySetInnerHTML/g,
    priority: 60,
    complexity: "moderate",
    summary: "Rendering raw HTML with dangerouslySetInnerHTML can introduce XSS.",
    remediation:
      "Ensure strict sanitization and provenance checks for any HTML passed to this API.",
  },
  {
    id: "document-write",
    title: "Potential XSS via document.write",
    category: "xss",
    pattern: /document\.write\s*\(/g,
    priority: 60,
    complexity: "moderate",
    summary: "document.write with untrusted data can introduce cross-site scripting.",
    remediation: "Replace document.write with safer DOM APIs and sanitize any untrusted content.",
  },
  {
    id: "insecure-http-url",
    title: "Insecure dependency or endpoint URL (http://)",
    category: "insecure-transport",
    pattern: /http:\/\/[^\s"'`]+/g,
    priority: 40,
    complexity: "simple",
    summary: "A plaintext HTTP URL was detected where HTTPS is preferred.",
    remediation:
      "Use HTTPS endpoints or secure transport. Document exceptions for internal trusted networks.",
  },
] as const;

/**
 * Scanner that detects common security risk patterns in source files.
 */
export class SecurityScanner implements Scanner {
  public readonly id = "security";
  public readonly name = "Security Scanner";

  public async scan(repoPath: string, options: ScanOptions = {}): Promise<Task[]> {
    if (options.maxTasks === 0) {
      return [];
    }

    const excludes = mergeExcludes(options.exclude);
    const candidateFiles = await collectScannableFiles(repoPath, {
      excludes,
      includeHidden: options.includeHidden === true,
      signal: options.signal,
    });

    if (candidateFiles.length === 0) {
      return [];
    }

    const findings: SecurityFinding[] = [];
    const findingKeys = new Set<string>();

    for (const filePath of candidateFiles) {
      throwIfAborted(options.signal);

      const absolutePath = resolve(repoPath, filePath);
      let fileSize = 0;
      try {
        const fileStats = await stat(absolutePath);
        fileSize = fileStats.size;
      } catch {
        continue;
      }

      if (fileSize > MAX_SCAN_FILE_SIZE_BYTES) {
        continue;
      }

      let content = "";
      try {
        content = await readFile(absolutePath, "utf8");
      } catch {
        continue;
      }

      const fileFindings = detectFileFindings(filePath, content);
      for (const finding of fileFindings) {
        const dedupeKey = [
          finding.filePath,
          String(finding.line),
          String(finding.column),
          finding.rule.id,
        ].join(":");

        if (!findingKeys.has(dedupeKey)) {
          findingKeys.add(dedupeKey);
          findings.push(finding);
        }
      }
    }

    if (findings.length === 0) {
      return [];
    }

    const discoveredAt = new Date().toISOString();
    const tasks = findings
      .map((finding) => buildTask(finding, discoveredAt))
      .sort((left, right) => {
        const byPriority = right.priority - left.priority;
        if (byPriority !== 0) {
          return byPriority;
        }
        const leftLine = Number(toRecord(left.metadata).line ?? 0);
        const rightLine = Number(toRecord(right.metadata).line ?? 0);
        const byPath = left.targetFiles[0]?.localeCompare(right.targetFiles[0] ?? "") ?? 0;
        if (byPath !== 0) {
          return byPath;
        }
        return leftLine - rightLine;
      });

    if (typeof options.maxTasks === "number" && options.maxTasks > 0) {
      return tasks.slice(0, options.maxTasks);
    }

    return tasks;
  }
}

interface CollectFilesOptions {
  excludes: string[];
  includeHidden: boolean;
  signal?: AbortSignal;
}

async function collectScannableFiles(
  rootDir: string,
  options: CollectFilesOptions,
): Promise<string[]> {
  const files: string[] = [];
  const excludeMatchers = options.excludes.map(compileGlobMatcher);

  async function walk(relativeDir: string): Promise<void> {
    throwIfAborted(options.signal);

    const absoluteDir = resolve(rootDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryName = String(entry.name);
      if (!options.includeHidden && entryName.startsWith(".")) {
        continue;
      }

      const relativePath = normalizeRelativePath(
        relativeDir ? `${relativeDir}/${entryName}` : entryName,
      );

      if (excludeMatchers.some((matches) => matches(relativePath))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isScannableFile(relativePath)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk("");
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function detectFileFindings(filePath: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const rule of SECURITY_RULES) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(content);
    while (match) {
      const matchText = match[0] ?? "";
      const position = toLineAndColumn(content, match.index);

      findings.push({
        filePath,
        line: position.line,
        column: position.column,
        matchText,
        rule,
      });

      if (matchText.length === 0) {
        rule.pattern.lastIndex += 1;
      }
      match = rule.pattern.exec(content);
    }
  }

  return findings;
}

function buildTask(finding: SecurityFinding, discoveredAt: string): Task {
  const title = `Security: ${finding.rule.title} in ${finding.filePath}:${finding.line}`;
  const safeMatchText = truncateInlineCode(sanitizeMatch(finding.matchText), 180);
  const description = [
    `${finding.rule.summary}`,
    `Location: \`${finding.filePath}:${finding.line}:${finding.column}\`.`,
    `Matched snippet: \`${safeMatchText}\`.`,
    `Remediation: ${finding.rule.remediation}`,
  ].join("\n\n");

  return {
    id: createTaskId(finding),
    source: "custom",
    title,
    description,
    targetFiles: [finding.filePath],
    priority: finding.rule.priority,
    complexity: finding.rule.complexity,
    executionMode: "new-pr",
    metadata: {
      scannerId: "security",
      securityCategory: finding.rule.category,
      pattern: finding.rule.id,
      filePath: finding.filePath,
      line: finding.line,
      column: finding.column,
      matchText: safeMatchText,
    },
    discoveredAt,
  };
}

function createTaskId(finding: SecurityFinding): string {
  const seed = [
    "security",
    finding.filePath,
    String(finding.line),
    String(finding.column),
    finding.rule.id,
    finding.matchText,
  ].join("::");

  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function toLineAndColumn(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, index);
  const lines = prefix.split(/\r?\n/);
  const line = lines.length;
  const currentLine = lines[lines.length - 1] ?? "";

  return {
    line,
    column: currentLine.length + 1,
  };
}

function isScannableFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return SCANNABLE_EXTENSIONS.has(extension);
}

function mergeExcludes(exclude: string[] | undefined): string[] {
  return Array.from(new Set([...DEFAULT_EXCLUDES, ...(exclude ?? [])].filter(Boolean)));
}

function compileGlobMatcher(pattern: string): (filePath: string) => boolean {
  const normalized = normalizeRelativePath(pattern.replace(/^!+/, "").trim());
  if (!normalized) {
    return () => false;
  }

  if (!normalized.includes("*")) {
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return (filePath: string) =>
      filePath === normalized || filePath.startsWith(prefix) || filePath.endsWith(`/${normalized}`);
  }

  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");

  const regex = new RegExp(`^${escaped}$`);
  return (filePath: string) => regex.test(filePath);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function sanitizeMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/`/g, "'");
}

function truncateInlineCode(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Security scanner aborted");
  }
}
