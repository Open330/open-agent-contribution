# Security Review — Round 6 — OAC v2026.221.1

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-21  
**Scope**: Multi-user concurrency guards (GitHub API calls for PR dedup), Codex npx invocation (env vars, process spawning), `stdin: "ignore"` hardening, JSONL envelope parsing (untrusted input handling).  
**Previous Score**: 9.3 / 10

---

## Security Review

### Summary
- **Overall Assessment**: STRONG
- **Score**: 9.4 / 10 (+0.1)
- **Key Strength**: `stdin: "ignore"` across all subprocess spawns eliminates an entire class of stdin-based attack vectors (process hijacking, credential prompt exploitation). This is a systematic security improvement.
- **Key Concern**: `pr.ts` constructs GitHub API URLs with user-supplied `owner` and `repo` values in `fetch()` calls. These values originate from parsed GitHub URLs and are reasonably trusted, but URL injection should be considered if the source changes.

### Round-5 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S5 | Config file code execution via `import()` | LOW | ⚠️ ACCEPTED RISK | Unchanged. Standard pattern. |
| S9 | Clone retry doesn't fast-fail on auth errors | LOW | ⚠️ OPEN | Still retries auth failures. |
| S13 | `adapterRegistry.register()` publicly callable | LOW | ⚠️ OPEN | Unchanged. |

### New Findings

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| S15 | `stdin: "ignore"` eliminates stdin attack surface | — | POSITIVE — All `execa` calls in `claude-code.adapter.ts`, `codex.adapter.ts`, `opencode.adapter.ts`, and `doctor.ts` now use `stdin: "ignore"`. This prevents: (1) rogue processes reading from parent stdin, (2) credential prompt hangs in headless contexts, (3) stdin-based process hijacking. |
| S16 | GitHub API token in fetch headers (scanner + pr.ts) | LOW | `fetchOacClaimedIssueNumbers` and `findExistingOacPR` (pr.ts) use `Authorization: Bearer ${token}` in fetch headers. Token comes from `GITHUB_TOKEN` env or `gh auth token`. The token is never logged, never included in error messages, and fetch uses HTTPS. Correct handling. |
| S17 | `AbortSignal.timeout` prevents hung API calls | — | POSITIVE — 15s timeout on `fetchOacClaimedIssueNumbers` prevents the scanner from hanging indefinitely on GitHub API issues. The abort error is caught and returns an empty set (graceful degradation). |
| S18 | Concurrency guard error messages don't leak data | — | POSITIVE — `findExistingOacPR` catch blocks log generic messages ("guard failed", "error checking for existing PR"). No token, repo credentials, or API response bodies exposed in error output. |
| S19 | `CODEX_MANAGED_BY_NPM: "1"` env var injection | — | POSITIVE — This env var tells the Codex binary it was launched via npx and should skip self-update prompts. The value is a hardcoded string literal, not user-controlled. No injection vector. |
| S20 | Codex `--ephemeral` flag | — | POSITIVE — Prevents Codex from persisting conversation state between runs. Each OAC task gets a clean Codex session. Reduces risk of cross-task data leakage. |
| S21 | JSONL envelope parsing from untrusted stdout | LOW | `parseFileEditFromPayload` and `parseToolUseFromPayload` parse JSON from subprocess stdout. The parsing is defensive — `isRecord()` type guards on every level, `readString()` with fallback to `undefined`. No `eval()`, no `Function()`, no prototype pollution vectors. `JSON.parse` is used correctly. |
| S22 | PR title/body matching uses string operations | — | POSITIVE — `findExistingOacPR` uses `title.startsWith("[OAC]")` and `body.includes()` for matching — no regex on attacker-controlled input. PR titles from GitHub API are trusted (fetched via authenticated API). |
| S23 | `pr.ts` URL construction from owner/repo | LOW | `https://api.github.com/repos/${owner}/${repo}/pulls` — `owner` and `repo` come from parsed GitHub repository URLs. Currently safe (GitHub enforces `[a-zA-Z0-9._-]` for owner/repo names). If these values ever come from user input, URL encoding would be needed. |

### Credential Handling Matrix — Updated

| Context | Credentials | Protection |
|---------|-------------|-----------|
| GitHub API (scanner PR fetch) | `GITHUB_TOKEN` or `gh auth token` | ✅ Bearer token in HTTPS header, never logged |
| GitHub API (pr.ts guard) | Same token | ✅ Same protection |
| GitHub API (Octokit handler) | Octokit auth | ✅ Managed by Octokit library |
| Codex execution | API keys via env | ✅ `stdin: "ignore"` prevents stdin leakage |
| Claude Code execution | API keys via env | ✅ `stdin: "ignore"` applied |
| OpenCode execution | API keys via env | ✅ `stdin: "ignore"` applied |
| Doctor checks | None | ✅ `stdin: "ignore"` prevents prompt hangs |

### Recommendations

1. **S9 — Fast-fail on auth errors** (LOW, carried over): `retryGitOperation` still retries auth failures. Consider adding error classification.

2. **S23 — URL construction safety** (INFORMATIONAL): If `owner`/`repo` sources ever change from parsed URLs to user input, add `encodeURIComponent()` to the URL template in `pr.ts`.

### Score Justification

The systematic application of `stdin: "ignore"` is the most significant security improvement this round — it eliminates an entire attack surface class. Credential handling in the new API calls is correct (HTTPS, no logging, timeout protection). JSONL parsing is defensive against malformed input. The concurrency guard error messages don't leak sensitive data. No new high or critical findings.

**Score: 9.4 / 10**

