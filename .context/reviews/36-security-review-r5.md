# Security Review — Round 5 — OAC v2026.220.1

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-20  
**Scope**: OpenCode adapter (process spawning, env handling), clone system (SSH fallback, credential handling), config-loader (code execution via import), adapter registry (runtime registration), setup script.  
**Previous Score**: 9.2 / 10

---

## Security Review

### Summary
- **Overall Assessment**: STRONG
- **Score**: 9.3 / 10 (+0.1)
- **Key Strength**: `GIT_TERMINAL_PROMPT=0` prevents credential prompt hangs that could stall the process indefinitely. The env-spreading pattern correctly preserves `SSH_AUTH_SOCK` for SSH operations without leaking it to untrusted contexts.
- **Key Concern**: The config-loader's `import()` of user-provided `.ts` files executes arbitrary code. This is an accepted risk (standard pattern for config files) but should remain documented.

### Round-4 Finding Resolutions

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| S1 | `sh -c` in dashboard for URL opening | HIGH | ✅ Resolved in R2 | Using `open` library. |
| S2 | Branch name validation | HIGH | ✅ Resolved in R2 | Sanitization in `sandbox.ts`. |
| S3 | Token scope documentation | LOW | ✅ Resolved in R4 | Documented in README. |
| S4 | `.oac/` in `.gitignore` | LOW | ✅ Resolved in R4 | Added to init template. |
| S5 | Config file code execution via `import()` | LOW | ⚠️ ACCEPTED RISK | Standard pattern (vite.config.ts, etc.). User owns the config file. |

### New Findings

| # | Finding | Severity | Details |
|---|---------|----------|---------|
| S6 | OpenCode adapter env propagation | — | POSITIVE — `processEnv` is built by filtering `process.env` for string values, then spreading `params.env` and OAC-specific vars. The filter `typeof entry[1] === 'string'` correctly handles Node.js's `undefined` env values. No credential leakage — same env as the parent process. |
| S7 | `GIT_TERMINAL_PROMPT=0` prevents credential hangs | — | POSITIVE — All `createGit()` calls set this. Prevents git from prompting for passwords (which would hang a headless process). This was the root cause of the clone hang bug. |
| S8 | SSH fallback doesn't expose credentials in error messages | — | POSITIVE — Error messages contain `httpsError.message` and `sshError.message`, which are git's own error messages. Git does not include credentials in its error output. |
| S9 | Clone retry doesn't amplify auth failures | LOW | `retryGitOperation` retries all errors, including auth failures (401/403). This means 4 failed auth attempts before giving up. Unlikely to trigger rate limits but not ideal — consider checking for auth-specific errors to fail fast. |
| S10 | `execa` with explicit args (no shell injection) | — | POSITIVE — OpenCode adapter uses `execa("opencode", ["run", "--format", "json", params.prompt])` — array args, no shell interpolation. `params.prompt` is safely passed as a single argument. |
| S11 | Config-loader data-URL fallback | LOW | The `data:text/javascript;base64,...` import is constructed from a user-owned config file that has already been read from disk. The base64 encoding is a transport mechanism, not a security boundary. The transformation correctly strips the `defineConfig` import and replaces the export pattern. No code injection vector beyond what the original file already contains. |
| S12 | Setup script uses `set -euo pipefail` | — | POSITIVE — Strict bash mode prevents silent failures. The script uses `curl -fsSL` (fail silently on HTTP errors, show errors, follow redirects, use TLS). |
| S13 | `adapterRegistry.register()` is publicly callable | LOW | Any code with access to the singleton can register a malicious adapter factory. In a CLI context this is not exploitable (attacker would need code execution, at which point they don't need the registry). In a hypothetical library/API context, consider restricting registration. |
| S14 | `forceKillTimer` in abort ensures process termination | — | POSITIVE — 3-second SIGTERM→SIGKILL escalation prevents zombie agent processes. `unref()` prevents the timer from keeping Node alive. |

### Credential Handling Matrix

| Context | Credentials | Protection |
|---------|-------------|-----------|
| GitHub API (`gh` CLI) | Token from `gh auth` | ✅ Managed by `gh` CLI, not by OAC |
| Git clone (HTTPS) | Token from `gh` credential helper | ✅ `GIT_TERMINAL_PROMPT=0` prevents prompts |
| Git clone (SSH) | SSH keys via `SSH_AUTH_SOCK` | ✅ Preserved by `{ ...process.env }` env spreading |
| OpenCode execution | API keys in env | ✅ Full env propagated (required for agent to function) |
| Config loading | None | ✅ No credentials involved |

### Recommendations

1. **S9 — Fast-fail on auth errors** (LOW): In `retryGitOperation`, consider checking if the error message contains `authentication failed` or `Permission denied` patterns and failing immediately rather than retrying 3 more times.

2. **S13 — Registry immutability** (LOW, INFORMATIONAL): For defense-in-depth, consider a `freeze()` method on `AdapterRegistry` that prevents further registrations after initialization. Not needed for current CLI usage.

### Score Justification

Security posture improved slightly. The `GIT_TERMINAL_PROMPT=0` fix addresses a real denial-of-service risk (hung process). The OpenCode adapter correctly uses array-based exec (no shell injection). Env handling is correct and well-documented. The config-loader's code execution risk remains accepted and is standard practice. No new high or critical findings.

**Score: 9.3 / 10**

