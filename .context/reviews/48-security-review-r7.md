# Security Review — Round 7

| Field | Value |
|-------|-------|
| **Reviewer Persona** | Senior Application Security Engineer |
| **Round** | 7 |
| **Version** | `2026.221.1` |
| **Date** | 2026-02-21 |
| **Scope** | Full codebase — 31 modules, ~4 800 LoC production |
| **Previous Score** | 9.4 / 10 (R6) |

---

## Executive Summary

R6 praised the systematic `stdin: "ignore"` hardening.  R7 finds two spots
that the hardening pass **missed**, plus a **URL encoding gap** in the CLI's
duplicate-PR guard and an **unsafe `process.env` cast**.

---

## 1. Missing `stdin: "ignore"` on Availability Checks (MEDIUM)

### Claude Code — `claude-code.adapter.ts:336`

```ts
const result = await execa("claude", ["--version"], { reject: false });
```

Missing `stdin: "ignore"`.  If the `claude` binary enters an interactive mode
(first-run wizard, license prompt), the subprocess blocks forever.

### OpenCode — `opencode.adapter.ts:261`

```ts
const result = await execa("opencode", ["--version"], { reject: false });
```

Same issue.

### Context

Every other `execa()` call in the codebase passes `stdin: "ignore"`:
- Codex `checkAvailability` (line 376) ✓
- Codex `codexNpxFallback` (line 334) ✓
- `doctor.ts` `runCommand` (line 293) ✓
- All three `execute()` calls ✓

These two are the only gaps in an otherwise thorough hardening.

### Recommendation

Add `stdin: "ignore"` + `timeout: 10_000` to both calls.

---

## 2. URL Encoding Gap in `pr.ts` (MEDIUM)

`pr.ts` line 133–134:

```ts
const url =
  `${GITHUB_API_BASE_URL}/repos/${repoFullName}` +
  `/pulls?state=open&…`;
```

`repoFullName` (e.g. `owner/repo`) is interpolated **without**
`encodeURIComponent()`.  In contrast, the scanner (`github-issues-scanner.ts`
lines 107–108) correctly encodes both `repo.owner` and `repo.name`.

### Exploitability

If `repoFullName` contains characters like `#`, `?`, or `%`, the resulting
URL is malformed.  In practice, GitHub repo names are restricted, so the risk
is LOW for GitHub.com but higher if OAC is extended to GitHub Enterprise with
relaxed naming rules.

### Recommendation

Split `repoFullName` on `/` and encode each segment, or accept `owner` and
`name` separately (matching the scanner's API).

---

## 3. Unsafe `process.env` Cast in `pr.ts` (LOW)

`pr.ts` line 25:

```ts
const ghEnv: Record<string, string> = { ...process.env } as Record<string, string>;
```

`process.env` values can be `undefined`.  The spread copies them as-is; the
`as` cast silently drops the `| undefined` type.  Downstream code that assumes
all values are strings may produce unexpected behaviour.

### Compare

All three adapters handle this correctly:

```ts
Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
)
```

`pr.ts` should use the same pattern.

---

## 4. Clone Retry on Auth Failures (LOW — carried)

`cloner.ts::retryGitOperation` retries ALL errors, including authentication
failures (HTTP 401/403).  Retrying a 403 three times with exponential backoff
(1s → 4s → 16s) wastes ~21 s and may trigger rate-limiting.

Recommendation: Parse the git error message for `401`, `403`, `authentication`,
`permission denied` and fast-fail on auth errors.

---

## 5. Registry `register()` Publicly Callable (LOW — carried)

`adapterRegistry.register()` allows runtime replacement of built-in adapters.
The risk is mitigated by the singleton not being in the public npm API surface.
An `Object.freeze()` after the three built-in registrations would close this.

---

## 6. Token in Memory (INFO)

`GITHUB_TOKEN` is held in process memory as a string variable throughout the
OAC run.  This is standard practice for CLI tools and unavoidable.  No
remediation needed.

---

## Positive Patterns Reaffirmed

- **`GIT_TERMINAL_PROMPT=0`**: Prevents silent credential prompts on git
  operations.
- **`extendEnv: false`** on Claude adapter: Prevents parent-process Claude
  session markers from leaking into the child.
- **`CLAUDECODE` / `CLAUDE_CODE_SESSION` stripping**: Correct defence against
  nested-session hangs.
- **`AbortSignal.timeout`** on all fetch calls: Prevents indefinite HTTP waits.
- **`forceKillTimer.unref()`**: Prevents the SIGKILL timer from keeping the
  Node process alive on clean exit.

---

## Score

| Criterion | Weight | Score |
|-----------|--------|-------|
| Input validation | 25% | 9.2 |
| Subprocess hardening | 30% | 9.3 |
| Secrets handling | 20% | 9.5 |
| Network security | 15% | 9.0 |
| Defence-in-depth | 10% | 10 |
| **Weighted Total** | | **9.3 / 10** |

Delta from R6: **−0.1** — the two missing `stdin: "ignore"` calls and the URL
encoding gap offset the otherwise strong hardening posture.

---

## Open Items

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | MEDIUM | Missing `stdin: "ignore"` (Claude + OpenCode) | NEW |
| 2 | MEDIUM | URL encoding gap in `pr.ts` | NEW |
| 3 | LOW | Unsafe `process.env` cast in `pr.ts` | NEW |
| 4 | LOW | Clone retry on auth failures | Carried |
| 5 | LOW | Registry `register()` publicly callable | Carried |

