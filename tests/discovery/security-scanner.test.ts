import { basename, dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type EntryKind = "file" | "directory";

interface VirtualDirectoryEntry {
  name: string;
  kind: EntryKind;
}

const REPO_PATH = "/repo";

const fsMockState = vi.hoisted(() => ({
  directories: new Map<string, VirtualDirectoryEntry[]>(),
  files: new Map<string, string>(),
  fileSizes: new Map<string, number>(),
  unreadableFiles: new Set<string>(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async (directoryPath: string, options?: { withFileTypes?: boolean }) => {
    const absolutePath = resolve(String(directoryPath));
    const entries = fsMockState.directories.get(absolutePath);
    if (!entries) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${absolutePath}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }

    if (!options?.withFileTypes) {
      return entries.map((entry) => entry.name);
    }

    return entries.map((entry) => createDirent(entry.name, entry.kind));
  }),
  readFile: vi.fn(async (filePath: string) => {
    const absolutePath = resolve(String(filePath));
    if (fsMockState.unreadableFiles.has(absolutePath)) {
      const error = new Error(`EACCES: permission denied, open '${absolutePath}'`);
      (error as NodeJS.ErrnoException).code = "EACCES";
      throw error;
    }

    const content = fsMockState.files.get(absolutePath);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${absolutePath}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return content;
  }),
  stat: vi.fn(async (filePath: string) => {
    const absolutePath = resolve(String(filePath));
    const content = fsMockState.files.get(absolutePath);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, stat '${absolutePath}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }

    const size = fsMockState.fileSizes.get(absolutePath) ?? Buffer.byteLength(content, "utf8");
    return { size };
  }),
}));

import type { Task } from "../../src/core/index.js";
import { SecurityScanner } from "../../src/discovery/scanners/security-scanner.js";

function createDirent(name: string, kind: EntryKind): import("node:fs").Dirent {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as import("node:fs").Dirent;
}

function resetVirtualRepo(): void {
  fsMockState.directories.clear();
  fsMockState.files.clear();
  fsMockState.fileSizes.clear();
  fsMockState.unreadableFiles.clear();
  ensureDirectory(REPO_PATH);
}

function addEntry(directoryPath: string, name: string, kind: EntryKind): void {
  const entries = fsMockState.directories.get(directoryPath);
  if (!entries) {
    return;
  }

  if (entries.some((entry) => entry.name === name && entry.kind === kind)) {
    return;
  }

  entries.push({ name, kind });
  entries.sort((left, right) => left.name.localeCompare(right.name));
}

function ensureDirectory(absoluteDirectoryPath: string): void {
  const normalizedDirectoryPath = resolve(absoluteDirectoryPath);
  if (fsMockState.directories.has(normalizedDirectoryPath)) {
    return;
  }

  fsMockState.directories.set(normalizedDirectoryPath, []);
  const parentPath = dirname(normalizedDirectoryPath);
  if (parentPath !== normalizedDirectoryPath) {
    ensureDirectory(parentPath);
    addEntry(parentPath, basename(normalizedDirectoryPath), "directory");
  }
}

function addVirtualFile(
  relativeFilePath: string,
  content: string,
  options: { sizeBytes?: number; unreadable?: boolean } = {},
): void {
  const absolutePath = resolve(REPO_PATH, relativeFilePath);
  const absoluteDir = dirname(absolutePath);
  ensureDirectory(absoluteDir);
  addEntry(absoluteDir, basename(absolutePath), "file");

  fsMockState.files.set(absolutePath, content);
  if (typeof options.sizeBytes === "number") {
    fsMockState.fileSizes.set(absolutePath, options.sizeBytes);
  } else {
    fsMockState.fileSizes.delete(absolutePath);
  }

  if (options.unreadable) {
    fsMockState.unreadableFiles.add(absolutePath);
  } else {
    fsMockState.unreadableFiles.delete(absolutePath);
  }
}

function findTaskByPattern(tasks: Task[], pattern: string): Task | undefined {
  return tasks.find((task) => {
    const metadata = task.metadata as Record<string, unknown>;
    return metadata.pattern === pattern;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetVirtualRepo();
});

describe("SecurityScanner", () => {
  it("detects hardcoded API keys", async () => {
    addVirtualFile("src/config.ts", 'const apiKey = "abcdefghijklmnopqrstuvwxyz123456";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toContain("Hardcoded API key");
    expect(tasks[0]?.priority).toBe(90);
    expect((tasks[0]?.metadata as Record<string, unknown>).securityCategory).toBe(
      "hardcoded-secrets",
    );
  });

  it("detects AWS access keys", async () => {
    addVirtualFile("src/aws.ts", 'const key = "AKIA1234567890ABCDEF";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "aws-access-key");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(90);
  });

  it("detects private key material", async () => {
    addVirtualFile(
      "src/keys.ts",
      [
        "export const privateKey = `-----BEGIN PRIVATE KEY-----",
        "MIIEvAIBADANBgkqhkiG9w0BAQEFAASC",
        "-----END PRIVATE KEY-----`;",
      ].join("\n"),
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "private-key-material");
    expect(finding).toBeDefined();
    expect(finding?.title).toContain("Embedded private key material");
  });

  it("detects eval() usage", async () => {
    addVirtualFile("src/runtime.js", "const result = eval(userInput);");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "unsafe-eval");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(70);
  });

  it("detects SQL injection patterns", async () => {
    addVirtualFile(
      "src/db.ts",
      "db.query(`SELECT * FROM users WHERE id = ${userId}`);",
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "sql-template-interpolation");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(80);
    expect((finding?.metadata as Record<string, unknown>).securityCategory).toBe("sql-injection");
  });

  it("detects innerHTML XSS patterns", async () => {
    addVirtualFile("src/view.ts", "container.innerHTML = userControlledHtml;");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "inner-html-assignment");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(60);
  });

  it("ignores findings under node_modules by default", async () => {
    addVirtualFile("node_modules/pkg/index.js", "eval(input)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("ignores test files when configured with exclude patterns", async () => {
    addVirtualFile("src/auth.test.ts", "const result = eval(payload);");

    const scanner = new SecurityScanner();
    const included = await scanner.scan(REPO_PATH);
    const excluded = await scanner.scan(REPO_PATH, { exclude: ["**/*.test.ts"] });

    expect(included).toHaveLength(1);
    expect(excluded).toEqual([]);
  });

  it("respects maxTasks limits", async () => {
    addVirtualFile("src/a.ts", 'const apiKey = "abcdefghijklmnopqrstuvwxyz123456";');
    addVirtualFile("src/b.ts", "const output = eval(payload);");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 1 });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.priority).toBe(90);
  });

  it("respects exclude patterns", async () => {
    addVirtualFile("src/kept.ts", 'const apiKey = "abcdefghijklmnopqrstuvwxyz123456";');
    addVirtualFile("src/ignored/secret.ts", 'const apiKey = "zzzzzzzzzzzzzzzzzzzzzzzzzzzz";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH, { exclude: ["src/ignored/**"] });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/kept.ts"]);
  });

  it("handles empty directories", async () => {
    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("handles file read errors gracefully", async () => {
    addVirtualFile("src/readable.ts", 'const apiKey = "abcdefghijklmnopqrstuvwxyz123456";');
    addVirtualFile("src/unreadable.ts", "const output = eval(payload);", { unreadable: true });

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/readable.ts"]);
  });

  it("generates correctly structured security tasks", async () => {
    addVirtualFile("src/config.ts", 'const apiKey = "abcdefghijklmnopqrstuvwxyz123456";');

    const scanner = new SecurityScanner();
    const [task] = await scanner.scan(REPO_PATH);

    expect(task).toBeDefined();
    expect(task?.id).toMatch(/^[a-f0-9]{16}$/);
    expect(task?.source).toBe("custom");
    expect(task?.title).toBe("Security: Hardcoded API key in src/config.ts:1");
    expect(task?.executionMode).toBe("new-pr");
    expect(task?.targetFiles).toEqual(["src/config.ts"]);
    expect(task?.description).toContain("Remediation:");
    expect(task?.discoveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
    expect(metadata.securityCategory).toBe("hardcoded-secrets");
    expect(metadata.pattern).toBe("hardcoded-api-key");
    expect(metadata.line).toBe(1);
    expect(metadata.column).toBeGreaterThanOrEqual(1);
  });

  // ── Scanner identity ────────────────────────────────────────

  it("has the expected id and name", () => {
    const scanner = new SecurityScanner();
    expect(scanner.id).toBe("security");
    expect(scanner.name).toBe("Security Scanner");
  });

  // ── Additional hardcoded secret patterns ────────────────────

  it("detects RSA private key material", async () => {
    addVirtualFile(
      "src/rsa.ts",
      'const key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIE...";',
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "private-key-material");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(90);
  });

  it("detects hardcoded passwords via generic secret pattern", async () => {
    addVirtualFile("src/auth.ts", 'const password = "super-secret-pass123";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "hardcoded-generic-secret");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(90);
  });

  it("detects hardcoded tokens via generic secret pattern", async () => {
    addVirtualFile("src/token.ts", 'const token = "ghp_abcdefghijklmnop1234";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "hardcoded-generic-secret");
    expect(finding).toBeDefined();
  });

  it("detects mongodb connection strings", async () => {
    addVirtualFile("src/mongo.ts", 'const uri = "mongodb://admin:pass@localhost:27017/mydb";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "connection-string");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(90);
  });

  it("detects postgres connection strings", async () => {
    addVirtualFile("src/pg.ts", 'const url = "postgres://user:pass@host:5432/production";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "connection-string");
    expect(finding).toBeDefined();
  });

  it("detects mysql connection strings", async () => {
    addVirtualFile("src/mysql.ts", 'const url = "mysql://root:secret@localhost:3306/app";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "connection-string");
    expect(finding).toBeDefined();
  });

  // ── Additional unsafe code execution patterns ───────────────

  it("detects Function constructor usage", async () => {
    addVirtualFile("src/dynamic.js", 'const fn = new Function("return 42");');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "unsafe-function-constructor");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(70);
  });

  // ── Additional SQL injection patterns ───────────────────────

  it("detects SQL injection via string concatenation in query()", async () => {
    addVirtualFile(
      "src/sql-concat.ts",
      'db.query("SELECT * FROM users WHERE id = " + userId);',
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "sql-string-concatenation");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(80);
  });

  // ── Additional XSS patterns ─────────────────────────────────

  it("detects dangerouslySetInnerHTML", async () => {
    addVirtualFile(
      "src/component.tsx",
      '<div dangerouslySetInnerHTML={{ __html: html }} />',
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "dangerously-set-inner-html");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(60);
  });

  it("detects document.write()", async () => {
    addVirtualFile("src/legacy.js", 'document.write("<h1>hello</h1>");');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "document-write");
    expect(finding).toBeDefined();
    expect(finding?.priority).toBe(60);
  });

  // ── File extension filtering ────────────────────────────────

  it("scans .py files", async () => {
    addVirtualFile("src/script.py", 'password = "hunter2hunter2abc"');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("scans .go files", async () => {
    addVirtualFile("src/main.go", "result := eval(userInput)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("scans .java files", async () => {
    addVirtualFile("src/App.java", 'String password = "hunter2hunter2abc";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("scans .rb files", async () => {
    addVirtualFile("src/app.rb", 'password = "hunter2hunter2abc"');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("scans .jsx files", async () => {
    addVirtualFile("src/component.jsx", "element.innerHTML = userInput;");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores non-source files like .md", async () => {
    addVirtualFile("src/notes.md", 'password = "hunter2hunter2abc"');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("ignores non-source files like .json", async () => {
    addVirtualFile("src/config.json", '{"password": "hunter2hunter2abc"}');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("ignores non-source files like .txt", async () => {
    addVirtualFile("src/notes.txt", 'password = "hunter2hunter2abc"');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  // ── Directory exclusion patterns ────────────────────────────

  it("skips dist directory by default", async () => {
    addVirtualFile("dist/bundle.js", "eval(input)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("skips build directory by default", async () => {
    addVirtualFile("build/output.js", "eval(input)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  // ── File size limits ────────────────────────────────────────

  it("skips files larger than 1MB", async () => {
    addVirtualFile("src/huge.ts", "eval(input)", { sizeBytes: 2_000_000 });

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("scans files at exactly 1MB", async () => {
    addVirtualFile("src/exact.ts", "eval(input)", { sizeBytes: 1_048_576 });

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toHaveLength(1);
  });

  // ── maxTasks edge cases ─────────────────────────────────────

  it("returns no tasks when maxTasks is 0", async () => {
    addVirtualFile("src/vuln.ts", "eval(input)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH, { maxTasks: 0 });

    expect(tasks).toEqual([]);
  });

  it("returns all tasks when maxTasks is negative", async () => {
    addVirtualFile("src/a.ts", "eval(inputA)");
    addVirtualFile("src/b.ts", "eval(inputB)");

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH, { maxTasks: -1 });

    expect(tasks).toHaveLength(2);
  });

  // ── Multiple findings and sorting ──────────────────────────

  it("creates separate tasks for each finding", async () => {
    addVirtualFile(
      "src/mixed.ts",
      [
        'const key = "AKIA1234567890ABCDEF";',
        "const result = eval(userInput);",
        "element.innerHTML = data;",
      ].join("\n"),
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("sorts tasks by priority descending", async () => {
    addVirtualFile("src/low.ts", "element.innerHTML = data;"); // priority 60
    addVirtualFile("src/high.ts", 'const key = "AKIA1234567890ABCDEF";'); // priority 90

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks[0]?.priority).toBeGreaterThanOrEqual(tasks[tasks.length - 1]!.priority);
  });

  // ── Deterministic IDs ───────────────────────────────────────

  it("produces the same task ID for the same input", async () => {
    addVirtualFile("src/stable.ts", 'const password = "secret12345678";');

    const scanner = new SecurityScanner();
    const tasks1 = await scanner.scan(REPO_PATH);
    const tasks2 = await scanner.scan(REPO_PATH);

    expect(tasks1.length).toBeGreaterThanOrEqual(1);
    expect(tasks1[0]?.id).toBe(tasks2[0]?.id);
  });

  // ── Line and column accuracy ────────────────────────────────

  it("reports correct line numbers for findings on non-first lines", async () => {
    addVirtualFile(
      "src/multiline.ts",
      '// safe line\n// another safe line\nconst password = "secret12345678";\n',
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    const finding = findTaskByPattern(tasks, "hardcoded-generic-secret");
    expect(finding).toBeDefined();
    const meta = finding?.metadata as Record<string, unknown>;
    expect(meta.line).toBe(3);
    expect((meta.column as number)).toBeGreaterThan(0);
  });

  // ── Clean source files ──────────────────────────────────────

  it("returns no findings for clean source code", async () => {
    addVirtualFile(
      "src/clean.ts",
      [
        "const config = process.env.API_KEY;",
        "const db = new Database(process.env.DATABASE_URL);",
        "function safeQuery(id: string) {",
        "  return db.query('SELECT * FROM users WHERE id = ?', [id]);",
        "}",
      ].join("\n"),
    );

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  // ── Hidden files ────────────────────────────────────────────

  it("skips hidden files by default", async () => {
    addVirtualFile(".env.ts", 'const password = "leakedpassword1234";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH);

    expect(tasks).toEqual([]);
  });

  it("includes hidden files when includeHidden is true", async () => {
    addVirtualFile(".secrets.ts", 'const password = "leakedpassword1234";');

    const scanner = new SecurityScanner();
    const tasks = await scanner.scan(REPO_PATH, { includeHidden: true });

    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });
});
