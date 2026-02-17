import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestGapScanner } from "../../src/discovery/scanners/test-gap-scanner.js";

let repoPath = "";

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = join(repoPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

function makeLineFile(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, index) => `export const value${index} = ${index};`,
  ).join("\n");
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "oac-test-gap-scanner-"));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe("TestGapScanner", () => {
  it("finds source files without tests", async () => {
    await writeRepoFile("src/has-test.ts", "export const hasTest = true;");
    await writeRepoFile("src/no-test.ts", "export const noTest = true;");
    await writeRepoFile("tests/has-test.test.ts", 'import { hasTest } from "../src/has-test";');

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.source).toBe("test-gap");
    expect(tasks[0]?.title).toBe("Add tests for no-test.ts");
    expect(tasks[0]?.targetFiles).toEqual(["src/no-test.ts"]);
  });

  it("matches tests in package-local tests directories", async () => {
    await writeRepoFile(
      "packages/demo/src/lib/math.ts",
      "export function add(a: number, b: number) { return a + b; }",
    );
    await writeRepoFile(
      "packages/demo/tests/lib/math.test.ts",
      'import { add } from "../../src/lib/math";',
    );

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath);

    expect(tasks).toEqual([]);
  });

  it("matches tests in __tests__ and src/__tests__ directories", async () => {
    await writeRepoFile("src/models/user.ts", "export class User {}");
    await writeRepoFile("src/services/auth.ts", "export const auth = () => true;");
    await writeRepoFile(
      "__tests__/models/user.test.ts",
      'import { User } from "../src/models/user";',
    );
    await writeRepoFile(
      "src/__tests__/services/auth.test.ts",
      'import { auth } from "../services/auth";',
    );

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath);

    expect(tasks).toEqual([]);
  });

  it("skips index.ts and .d.ts files", async () => {
    await writeRepoFile("src/index.ts", 'export * from "./feature";');
    await writeRepoFile("src/types.d.ts", "export interface TypesOnly {}");
    await writeRepoFile("src/feature.ts", "export const feature = true;");

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/feature.ts"]);
  });

  it("respects exclude patterns", async () => {
    await writeRepoFile("src/feature.ts", "export const feature = true;");
    await writeRepoFile("src/ignored/hidden.ts", "export const hidden = true;");

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath, { exclude: ["src/ignored/**"] });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.targetFiles).toEqual(["src/feature.ts"]);
  });

  it("handles empty repositories", async () => {
    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath);
    expect(tasks).toEqual([]);
  });

  it("respects maxTasks cap", async () => {
    await writeRepoFile("src/a.ts", "export const a = 1;");
    await writeRepoFile("src/b.ts", "export const b = 2;");
    await writeRepoFile("src/c.ts", "export const c = 3;");

    const scanner = new TestGapScanner();
    const tasks = await scanner.scan(repoPath, { maxTasks: 2 });

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.targetFiles[0])).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("assigns simple complexity for files smaller than 50 lines", async () => {
    await writeRepoFile("src/small.ts", makeLineFile(49));

    const scanner = new TestGapScanner();
    const [task] = await scanner.scan(repoPath);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;

    expect(task?.complexity).toBe("simple");
    expect(metadata.complexityBucket).toBe("small");
    expect(metadata.estimatedTokens).toBe(1_500);
  });

  it("assigns moderate complexity for files smaller than 200 lines", async () => {
    await writeRepoFile("src/medium.ts", makeLineFile(50));

    const scanner = new TestGapScanner();
    const [task] = await scanner.scan(repoPath);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;

    expect(task?.complexity).toBe("moderate");
    expect(metadata.complexityBucket).toBe("medium");
    expect(metadata.estimatedTokens).toBe(4_000);
  });

  it("assigns complex complexity for files with at least 200 lines", async () => {
    await writeRepoFile("src/large.ts", makeLineFile(200));

    const scanner = new TestGapScanner();
    const [task] = await scanner.scan(repoPath);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;

    expect(task?.complexity).toBe("complex");
    expect(metadata.complexityBucket).toBe("large");
    expect(metadata.estimatedTokens).toBe(8_000);
  });

  it("generates deterministic task IDs", async () => {
    await writeRepoFile("src/deterministic.ts", "export const deterministic = true;");

    const scanner = new TestGapScanner();
    const firstRun = await scanner.scan(repoPath);
    const secondRun = await scanner.scan(repoPath);

    expect(firstRun[0]?.id).toBe(secondRun[0]?.id);
    expect(firstRun[0]?.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("includes discovered function and class names in the description", async () => {
    await writeRepoFile(
      "src/symbols.ts",
      [
        "export function createThing(): string {",
        '  return "ok";',
        "}",
        "",
        "export class ThingService {}",
        "",
        'export const buildThing = () => "built";',
      ].join("\n"),
    );

    const scanner = new TestGapScanner();
    const [task] = await scanner.scan(repoPath);

    expect(task?.description).toContain("`ThingService`");
    expect(task?.description).toContain("`buildThing`");
    expect(task?.description).toContain("`createThing`");
  });
});
