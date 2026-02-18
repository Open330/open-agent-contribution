# Task: Write unit tests for packages/repo

## Goal
Create comprehensive unit tests for `packages/repo`. Write test files in `packages/repo/tests/`.

## Test Framework
- Vitest (globals enabled: `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` are available globally)
- Import from vitest: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`
- Import source using relative paths: `import { ... } from '../src/resolver.js';`

## Files to Test

### 1. `packages/repo/tests/resolver.test.ts` — Test `parseRepoInput` logic (exported via `resolveRepo`)

Since `parseRepoInput` is private, test it indirectly through the public API, or test the pure helper functions. Focus on testing the regex patterns and URL parsing by mocking Octokit.

Key test cases:
- `RepoResolutionError` class: has correct `code`, `name`, `message`
- Empty input throws `INVALID_INPUT`
- Valid `owner/repo` format parsing
- Valid `owner/repo.git` format (strips .git suffix)
- SSH format `git@github.com:owner/repo.git`
- HTTPS URL `https://github.com/owner/repo`
- URL with `www.github.com`
- URL with `github.com/owner/repo` (no protocol — auto-prefixed)
- Non-github host throws `INVALID_INPUT`
- Invalid URL format throws `INVALID_INPUT`
- `normalizePermissions` (private but testable via mocked API response):
  - With all permissions defined
  - With undefined permissions on public repo (pull defaults to true)
  - With undefined permissions on private repo (pull defaults to false)
- `normalizeLicense`: null → null, "NOASSERTION" → null, "MIT" → "MIT"

Since most functions are private, mock `Octokit` and test `resolveRepo` end-to-end:
```typescript
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      get: vi.fn(),
      listLanguages: vi.fn(),
      getBranch: vi.fn(),
    },
  })),
}));
```

### 2. `packages/repo/tests/metadata-cache.test.ts` — Test `MetadataCache` class

This is easily testable with a temp directory.

Key test cases:
- `get()` returns null for missing key
- `set()` then `get()` returns the stored repo
- Cache key normalization (case-insensitive: `Owner/Repo` === `owner/repo`)
- TTL expiration: set with custom `now`, advance time past TTL, `get()` returns null
- TTL not expired: set with custom `now`, advance time within TTL, `get()` returns value
- `invalidate()` with specific key removes only that entry
- `invalidate()` without key clears all entries
- Cache file is created on first write
- Corrupt cache file returns empty (write garbage, then `get()`)
- Wrong version in cache file returns empty
- Atomic write (temp file + rename)

Use `os.tmpdir()` + unique path for `filePath` option. Use custom `now` function to control time.

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataCache } from '../src/metadata-cache.js';
```

## Important Notes
- Do NOT import from `@oac/core` types — use inline type stubs if needed
- Each test file should be self-contained
- Use `vi.fn()` and `vi.mock()` for mocking
- Target: 15-25 tests per file
- Keep tests focused and fast (no real network calls)
