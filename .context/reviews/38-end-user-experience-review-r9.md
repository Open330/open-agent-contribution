# End-User Experience Review — Round 9 — OAC v2026.220.1

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-20  
**Scope**: Re-evaluation after clone system rewrite (HTTPS→SSH fallback, error messages), config-loader Node < 22.6 fix, OpenCode provider support, setup script, CalVer versioning.  
**Previous review**: `16-end-user-experience-review-r8.md` (Score: 10/10)

---

## 1. Executive Summary

This round focuses on **real-world deployment UX** — the changes address failures that users encounter when running OAC on a fresh machine or with non-standard environments. The clone hang fix and config-loader compatibility fix are the two most impactful UX improvements since the run.ts decomposition.

**UX Score: 10/10** — Maintained. Critical real-world blockers resolved. New provider adds choice without complexity.

---

## 2. Changes — UX Impact Assessment

| Change | UX Impact | Assessment |
|--------|-----------|-----------|
| Clone HTTPS→SSH fallback | ✅ **Critical fix** — Users with SSH keys but no HTTPS credentials can now clone repos. Previously: silent infinite hang. Now: automatic fallback with clear error on total failure. |
| `GIT_TERMINAL_PROMPT=0` | ✅ **Critical fix** — Prevents the process from hanging indefinitely waiting for credential input that will never come in a headless context. |
| Config-loader `ERR_UNKNOWN_FILE_EXTENSION` | ✅ **Critical fix** — Users on Node 20-22.5 can now use `oac.config.ts`. Previously: config silently ignored, OAC runs with defaults. |
| Config regex: `@open330/oac` match | ✅ **Important fix** — `oac init` generates config importing from `@open330/oac`, but the loader only matched `@open330/oac-core`. Now matches both. |
| OpenCode provider support | ✅ New option — Users can now use `--provider opencode` with no additional configuration beyond having the OpenCode CLI installed. |
| Adapter registry | Transparent — Users don't see this. It enables future custom providers. |
| Setup script | ✅ Convenience — One-liner setup for new devices. Clear env var documentation. |
| CalVer versioning | ✅ Clarity — `2026.220.1` tells users when the version was built. More meaningful than SemVer for a rapidly evolving CLI. |

---

## 3. Error Message Quality — Clone Failures

### Before (silent hang):
```
[oac] Preparing local clone...
█ (hangs forever — git prompting for credentials)
```

### After (clear error):
```
Failed to clone "owner/repo" via both HTTPS and SSH.
Ensure git credentials are configured: run `gh auth login` or set up SSH keys.
HTTPS error: Authentication failed for 'https://github.com/owner/repo.git'
SSH error: Permission denied (publickey).
```

This is excellent error UX:
1. **What failed** — Both clone methods
2. **How to fix it** — Two concrete actions (`gh auth login` or SSH keys)
3. **Diagnostic details** — Both error messages for debugging

---

## 4. Config Loading UX — Node Compatibility

### Before (Node 20-22.5):
```
$ oac run --repo owner/repo
# Config silently returns null → runs with defaults
# User doesn't know their oac.config.ts was ignored
```

### After:
```
$ oac run --repo owner/repo
# ERR_UNKNOWN_FILE_EXTENSION caught → data-URL fallback → config loaded correctly
```

The fix is invisible to the user — which is correct. Config files should "just work" regardless of Node version. The warning message on complete failure (`Failed to load config at oac.config.ts: ...`) remains available for actual config errors.

---

## 5. New Provider UX — OpenCode

Adding a third provider is handled cleanly:
- `oac run --provider opencode` — Just works if OpenCode CLI is installed
- `oac doctor` — Checks OpenCode availability alongside Claude Code and Codex
- Error on missing: `Agent CLI "opencode" is not available: ... Install the opencode CLI or switch providers. Run \`oac doctor\` for setup instructions.`

No new flags, no new config keys, no breaking changes. The provider is discovered through the existing `--provider` option.

---

## 6. Setup Script UX

`scripts/setup-contributor.sh` provides:
- Env var-based configuration (no interactive prompts)
- Pre-flight checks (Node version, npm, provider CLI)
- Clear success/failure output with colored indicators
- `SKIP_RUN=1` option for setup-only mode
- `DRY_RUN=1` for preview without execution

Good for automated/CI environments where interactive prompts are not possible.

---

## 7. Previous Open Items

| Item | Status | Notes |
|------|--------|-------|
| All P3 UX items from R8 | ✅ Closed | `--minimal`, colored diff, `oac explain`, troubleshooting docs |
| Status watch flicker | ⚠️ Open (cosmetic) | Terminal refresh rate issue, low priority |

---

## 8. Recommendations

1. **Config loading warning** (INFORMATIONAL): When config is loaded via the fallback path, consider a `--verbose` debug message indicating the fallback was used. Helps users diagnose Node version issues.

2. **Provider auto-detection** (FUTURE): Consider auto-detecting which providers are available and selecting the first one, rather than defaulting to `claude-code`. Would improve first-run UX for users who only have OpenCode installed.

---

## 9. Score Justification

The clone hang and config-loader fixes resolve the two most severe UX blockers reported in real-world testing. Users on Node 20+ with SSH-only or HTTPS-only git configurations now get a working experience. The OpenCode provider adds choice without complexity. Error messages are actionable and diagnostic.

**UX Score: 10 / 10** (maintained — critical blockers resolved, no regressions)

