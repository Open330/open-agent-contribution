/** File path prefixes that are OAC internal metadata, not real code changes. */
const METADATA_PREFIXES = [".oac/"];

/** Returns true if the file path is a real code change (not OAC metadata). */
export function isRealFileChange(filePath: string): boolean {
  return !METADATA_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

/** Filters a list of file paths to only real (non-metadata) changes. */
export function filterRealChanges(files: string[]): string[] {
  return files.filter(isRealFileChange);
}
