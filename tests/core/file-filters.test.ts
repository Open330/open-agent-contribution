import { describe, expect, it } from "vitest";

import { filterRealChanges, isRealFileChange } from "../../src/core/file-filters.js";

describe("isRealFileChange", () => {
  it("returns true for regular source files", () => {
    expect(isRealFileChange("src/index.ts")).toBe(true);
    expect(isRealFileChange("README.md")).toBe(true);
    expect(isRealFileChange("package.json")).toBe(true);
  });

  it("returns false for .oac/ metadata files", () => {
    expect(isRealFileChange(".oac/config.json")).toBe(false);
    expect(isRealFileChange(".oac/tasks/task-1.json")).toBe(false);
  });

  it("returns true for files containing .oac in a non-prefix position", () => {
    expect(isRealFileChange("src/.oac-utils.ts")).toBe(true);
    expect(isRealFileChange("docs/oac-guide.md")).toBe(true);
  });

  it("returns true for an empty string", () => {
    expect(isRealFileChange("")).toBe(true);
  });
});

describe("filterRealChanges", () => {
  it("returns an empty array when given an empty array", () => {
    expect(filterRealChanges([])).toEqual([]);
  });

  it("keeps all files when none are metadata", () => {
    const files = ["src/index.ts", "package.json", "tests/foo.test.ts"];
    expect(filterRealChanges(files)).toEqual(files);
  });

  it("removes .oac/ metadata files", () => {
    const files = ["src/index.ts", ".oac/config.json", "README.md", ".oac/logs/run.log"];
    expect(filterRealChanges(files)).toEqual(["src/index.ts", "README.md"]);
  });

  it("returns an empty array when all files are metadata", () => {
    const files = [".oac/a", ".oac/b/c"];
    expect(filterRealChanges(files)).toEqual([]);
  });
});
