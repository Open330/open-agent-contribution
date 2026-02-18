# Security Review — Round 2 — OAC v2026.4.3

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-18  
**Scope**: Re-assessment after Wave 1–4 fixes (21 files changed, +766 −441 lines)  
**Previous Score**: 7.5 / 10

---

## Security Review

### Summary
- **Risk Level**: LOW (was HIGH)
- **Score**: 9.0 / 10 (+1.5)
- **Findings**: 2 remaining (0 critical, 0 high, 1 medium, 1 low)
- **Recommendation**: APPROVE — All critical and high findings resolved. Remaining items are accepted risks.

### Round-1 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S1 | Shell injection in dashboard `exec()` | CRITICAL | ✅ RESOLVED | Replaced with `execFile(command, [url])`. Arguments are now passed as an array — no shell interpretation. The `command` is platform-detected (`open`/`xdg-open`/`start`), and `url` is passed as a separate argument. Verified: no shell metacharacters can escape. |
| S2 | `sh -c` shell redirect in github-auth | HIGH | ✅ RESOLVED | Replaced with `spawnSync("gh", ["auth", "status"])`. Captures both stdout and stderr via `stdio: ["ignore", "pipe", "pipe"]` without spawning a shell. Clean separation. |
| S3 | Unsanitized branch names in sandbox | HIGH | ✅ RESOLVED | Added `SAFE_BRANCH_RE = /^[a-zA-Z0-9/_.-]+$/` with validation for both `branchName` and `baseBranch` before any git operation. Throws `AGENT_EXECUTION_FAILED` on invalid names. |
| S4 | Missing timeout on GitHub API fetch | MEDIUM | ✅ RESOLVED | Added `signal: AbortSignal.timeout(30_000)` to fetch options. Clean `AbortError` on timeout — won't hang indefinitely. |
| S5 | Dynamic import of config file | MEDIUM | ⚠️ ACCEPTED RISK | Still uses `import(pathToFileURL(...))` for `oac.config.ts`. This is by design (same pattern as vite/eslint). Mitigated by documentation. See remaining finding below. |
| S6 | GitHub token scope documentation | LOW | ✅ RESOLVED | Added JSDoc documenting minimum required scopes (`repo`). `checkGitHubScopes()` function validates scope presence. |
| S7 | No rate limiting on SSE endpoint | LOW | ✅ RESOLVED | Added `MAX_SSE_CLIENTS = 50` cap. Responds with 503 when limit is reached. Appropriate for a local dashboard. |
| S8 | `.oac/` not in `.gitignore` | LOW | ✅ RESOLVED | `oac init` now calls `ensureGitignoreEntry()` which creates or appends `.oac/` to `.gitignore`. Applied in both minimal and interactive init paths. |

### Remaining Findings

#### [MEDIUM] S5 (carried over): Config file code execution — accepted risk

- **Category**: Insecure Deserialization
- **File**: `src/cli/config-loader.ts:40`
- **CWE**: CWE-502
- **Description**: `oac.config.ts` is loaded via dynamic `import()`, executing arbitrary code. This is the standard pattern for TypeScript config files (vite, eslint, tsup, etc.) and enables `defineConfig()` with IDE autocomplete.
- **Mitigation**: Users must only run OAC on repositories they trust — same trust model as any build tool.
- **Recommendation**: Consider adding a `--no-config` flag for CI environments where config execution is undesirable. Low priority — accepted risk.

#### [LOW] S9 (new): `isRecord` defined in two modules

- **File**: `src/execution/normalize-error.ts:3`, `src/execution/agents/shared.ts:94`
- **Description**: Both modules define an identical `isRecord()` type guard. While neither is exported at a layer boundary (both are internal to `execution/`), the duplication could lead to inconsistency if one is updated without the other.
- **Impact**: No security impact. Cosmetic code quality issue.
- **Recommendation**: Consolidate to a single location when convenient. Not a security concern.

### Security Posture — Post-Fix Assessment

**Command Injection Surface** — Eliminated:
- ✅ All `child_process` calls use `execFile`/`execFileSync`/`spawnSync` with array arguments
- ✅ No `exec()`, `execSync()`, or `sh -c` patterns remain in codebase
- ✅ `execa` used with array args for all agent subprocess invocations
- ✅ Branch names validated with regex before git operations

**Input Validation** — Strong:
- ✅ Config validated with Zod strict schemas
- ✅ Branch names validated with `SAFE_BRANCH_RE`
- ✅ URL components encoded with `encodeURIComponent`
- ✅ No unvalidated user input reaches shell or SQL

**Network Security** — Adequate:
- ✅ All HTTP calls have timeouts (30s for fetch, 5s for auth checks)
- ✅ SSE connections capped at 50
- ✅ GitHub token sourced from env vars or `gh auth token`, never hardcoded

**Data Protection** — Acceptable:
- ✅ `.oac/` added to `.gitignore` during init
- ✅ Token scopes documented
- ✅ No secrets in source code
- ✅ Atomic writes prevent data corruption

### Positive Observations — Updated

1. **Zero shell injection vectors** — The entire codebase now uses argument-array subprocess invocation. This is the gold standard for Node.js security.
2. **Defense in depth on branch names** — `sanitizeBranchSegment` normalizes branch name parts, and `SAFE_BRANCH_RE` validates the full name. Two independent layers.
3. **Consistent timeout discipline** — Every external call (network, subprocess, auth) has an explicit timeout. No indefinite hangs possible.
4. **Clean SSE connection management** — Cap + 503 response + cleanup on disconnect. Simple and correct.
5. **`.gitignore` enforcement** — `ensureGitignoreEntry()` handles both creation and append, and is called from both init paths. No gap.

### Dependency Audit Recommendation

Still recommend adding `pnpm audit` to pre-publish checks. Key dependencies to monitor:
- `execa` v9 — Process execution (command injection surface)
- `simple-git` v3 — Git operations (argument injection surface)
- `fastify` v5 — HTTP server for dashboard (network surface)
- `zod` v3 — Input validation (foundational control)

