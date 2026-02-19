# Security Review — Round 4 — OAC v2026.4.3

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after utility consolidation and CI hardening (commit `55780e4`). Key security changes: SHA-pinned all GitHub Actions, added `pnpm audit --prod` CI job, consolidated `isRecord` type guard.  
**Previous Score**: 9.0 / 10

---

## Security Review

### Summary
- **Risk Level**: LOW
- **Score**: 9.2 / 10 (+0.2)
- **Findings**: 1 remaining (0 critical, 0 high, 1 medium, 0 low) — reduced from 2
- **Recommendation**: APPROVE — Supply chain hardening is complete. All actionable findings resolved.

### Round-3 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S5 | Config file code execution via `import()` | MEDIUM | ⚠️ ACCEPTED RISK | Unchanged. Standard pattern (vite/eslint/tsup). |
| S9 | `isRecord` in 4 locations | LOW | ✅ **RESOLVED** | Consolidated to `src/core/utils.ts:25`. Single definition, consistent behavior. |
| S10 | CI actions not SHA-pinned | LOW | ✅ **RESOLVED** | All 9 action references across `ci.yml` and `release.yml` now use full commit SHAs with version comments. |
| Audit rec | Add `pnpm audit` to CI | — | ✅ **RESOLVED** | `pnpm audit --prod --audit-level=high` job added to `ci.yml`. Catches HIGH+ severity vulnerabilities in production dependencies. |

### Security Posture — Updated

**Command Injection Surface** — Eliminated:
- ✅ All `child_process` calls use `execFile`/`execFileSync`/`spawnSync` with array args
- ✅ No `exec()`, `execSync()`, or `sh -c` patterns
- ✅ Branch names validated with `SAFE_BRANCH_RE`
- ✅ Dashboard browser opener uses `open` library (no shell interpolation)

**Input Validation** — Strong:
- ✅ Config validated with Zod strict schemas
- ✅ Branch names validated with regex
- ✅ URL components encoded
- ✅ `isRecord` type guard now has single source of truth (consistency eliminates divergence risk)

**Network Security** — Adequate:
- ✅ All HTTP calls have timeouts (`AbortSignal.timeout`)
- ✅ SSE connections capped at 50
- ✅ GitHub token sourced securely via `gh auth token`

**Supply Chain** — Fully Hardened:
- ✅ CI uses `--frozen-lockfile` 
- ✅ Release gated on tag push + npm secret
- ✅ `prepublishOnly` runs build + test
- ✅ **All CI actions SHA-pinned** (NEW — resolved S10)
- ✅ **`pnpm audit --prod` in CI** (NEW — catches vulnerable deps)

### Remaining Findings

#### [MEDIUM] S5 (carried over): Config file code execution — accepted risk

- **Category**: Insecure Deserialization
- **File**: `src/cli/config-loader.ts:40`
- **CWE**: CWE-502
- **Description**: `oac.config.ts` loaded via dynamic `import()`, executing arbitrary code. This is the standard pattern for TypeScript configuration files across the Node.js ecosystem.
- **Mitigation**: Same trust model as vite, eslint, tsup. Users only run OAC on repositories they trust. The `import()` is limited to the repo root — no remote URL loading.
- **Risk acceptance**: This finding is accepted risk with clear rationale. No action required unless the threat model changes (e.g., OAC running in a multi-tenant CI environment).

### Positive Observations — New

1. **SHA-pinned CI actions** — All 9 `uses:` directives now reference full commit SHAs (`actions/checkout@34e11487...`, `pnpm/action-setup@c5ba7f78...`, etc.) with human-readable version comments (`# v4`). This eliminates the tag-based supply chain risk entirely.
2. **Dependency audit gate** — `pnpm audit --prod --audit-level=high` runs on every push and PR. This is the recommended defense against supply chain vulnerabilities in transitive dependencies.
3. **`isRecord` consolidation** — While primarily a code quality improvement, having a single type guard definition eliminates the risk of behavioral divergence (e.g., one copy being updated to handle `null` prototype objects while others don't).
4. **Annotated catch blocks** — The `// best-effort` comments make the error-swallowing intent explicit. This helps security reviewers quickly distinguish intentional suppression from oversight.

### Dependency Audit Status

Key dependencies remain secure:
- `execa` v9 — No known CVEs. Process execution with array args (no shell injection).
- `simple-git` v3 — No known CVEs. Git operations via `execFile`.
- `fastify` v5 — No known CVEs. HTTP server for dashboard.
- `zod` v3 — No known CVEs. Input validation foundation.
- `p-queue` v8 — No known CVEs. Concurrency control.

The new `pnpm audit --prod` CI job will automatically catch any future CVEs in these dependencies.

### Recommendations

1. **No immediate actions required** — All actionable findings are resolved.
2. **Monitor `S5` (config import)** — If OAC usage expands to untrusted CI environments, consider adding `--no-config` flag.
3. **Consider Dependabot/Renovate** — Automated dependency updates would complement the audit job by proactively updating before CVEs are published.

