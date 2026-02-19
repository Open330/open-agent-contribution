# Security Review — Round 3 — OAC v2026.4.3

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-19  
**Scope**: Re-assessment after deploy readiness fixes (commit `91898c8`). CI/CD workflows, package.json, README changes.  
**Previous Score**: 9.0 / 10

---

## Security Review

### Summary
- **Risk Level**: LOW
- **Score**: 9.0 / 10 (unchanged)
- **Findings**: 2 remaining (0 critical, 0 high, 1 medium, 1 low) — unchanged from round-2
- **Recommendation**: APPROVE — Infrastructure changes are security-positive. No new attack surface introduced.

### Round-2 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S5 | Config file code execution via `import()` | MEDIUM | ⚠️ ACCEPTED RISK | Unchanged. Standard pattern (vite/eslint/tsup). Users must trust repos they run OAC on. |
| S9 | `isRecord` defined in 2 modules | LOW | ⚠️ OPEN (expanded) | Now **4 definitions** found (see below). No security impact — cosmetic quality issue. |

### New: CI/CD Security Assessment

The newly added CI/CD workflows have several security-relevant aspects:

#### [POSITIVE] Security-Strengthening Changes

1. **`--frozen-lockfile` in all CI jobs** — Prevents supply chain attacks via lockfile manipulation. If `pnpm-lock.yaml` doesn't match `package.json`, CI fails. This is a critical defense against dependency confusion attacks.

2. **`release.yml` uses `secrets.NPM_TOKEN`** — Token is stored as a GitHub Secret, never in source code. Correct approach.

3. **`release.yml` triggered only on `v*` tags** — Prevents accidental publishes from branch pushes. Tag-based release gating is the recommended pattern.

4. **`softprops/action-gh-release@v2`** — Used for GitHub Release creation. This is a well-maintained action (10K+ stars). Low supply chain risk.

5. **`permissions: contents: write`** — Scoped to minimum needed for release job. Not using `permissions: write-all`. Good least-privilege practice.

6. **`prepublishOnly: "pnpm build && pnpm test"`** — Safety net against publishing broken or untested code. Prevents "oops" publishes.

#### [LOW] S10 (new): CI workflow uses `actions/checkout@v4` without pinned SHA

- **Category**: Supply Chain
- **CWE**: CWE-829 (Inclusion of Functionality from Untrusted Control Sphere)
- **File**: `.github/workflows/ci.yml:18,29,47,60`, `.github/workflows/release.yml:16,35`
- **Description**: All `uses:` directives reference tag versions (`@v4`, `@v2`) instead of pinned commit SHAs. A compromised upstream action could inject malicious code into the CI pipeline.
- **Impact**: LOW — These are all GitHub-official or widely-trusted actions (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `softprops/action-gh-release`). The risk is theoretical for this trust level.
- **Recommendation**: For maximum supply chain security, pin to specific SHAs:
  ```yaml
  - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
  ```
  Low priority — acceptable for most open source projects.

### Remaining Findings

#### [MEDIUM] S5 (carried over): Config file code execution — accepted risk

- **Category**: Insecure Deserialization
- **File**: `src/cli/config-loader.ts:40`
- **CWE**: CWE-502
- **Description**: `oac.config.ts` loaded via dynamic `import()`, executing arbitrary code. Standard pattern for TS config files.
- **Mitigation**: Same trust model as vite, eslint, tsup. Users only run OAC on trusted repos.
- **Recommendation**: Consider `--no-config` flag for CI environments. Low priority.

#### [LOW] S9 (expanded): `isRecord` defined in 4 locations

- **Files**:
  - `src/execution/agents/shared.ts:94` (exported)
  - `src/execution/normalize-error.ts:3` (local)
  - `src/cli/commands/status.ts:228` (local)
  - `src/cli/commands/leaderboard.ts:267` (local)
- **Description**: 4 identical implementations of the same type guard. Round-2 identified only 2 in the execution layer — the CLI layer has 2 more.
- **Impact**: No security impact. If one copy is updated (e.g., to handle `null` prototype objects), the others would diverge silently.
- **Recommendation**: Consolidate to `src/core/utils.ts`. Cosmetic.

### Security Posture — Updated

**Command Injection Surface** — Eliminated (unchanged):
- ✅ All `child_process` calls use `execFile`/`execFileSync`/`spawnSync` with array args
- ✅ No `exec()`, `execSync()`, or `sh -c` patterns
- ✅ Branch names validated with `SAFE_BRANCH_RE`

**Input Validation** — Strong (unchanged):
- ✅ Config validated with Zod strict schemas
- ✅ Branch names validated with regex
- ✅ URL components encoded

**Network Security** — Adequate (unchanged):
- ✅ All HTTP calls have timeouts
- ✅ SSE connections capped at 50
- ✅ GitHub token sourced securely

**Supply Chain** — Improved:
- ✅ CI uses `--frozen-lockfile` (NEW)
- ✅ Release gated on tag push + npm secret (NEW)
- ✅ `prepublishOnly` runs build + test (NEW)
- ⚠️ Actions not SHA-pinned (low risk)

### Dependency Audit Recommendation

Now that CI/CD is in place, this is the ideal time to add `pnpm audit` as a CI step:

```yaml
# Add to ci.yml after lint job
audit:
  name: Security Audit
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm audit --audit-level=high
```

Key dependencies to monitor:
- `execa` v9 — Process execution (command injection surface)
- `simple-git` v3 — Git operations (argument injection surface)
- `fastify` v5 — HTTP server (network surface)
- `zod` v3 — Input validation (foundational control)

