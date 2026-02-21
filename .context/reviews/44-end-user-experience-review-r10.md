# End-User Experience Review — Round 10 — OAC v2026.221.1

**Reviewer**: end-user-experience-reviewer  
**Date**: 2026-02-21  
**Scope**: Multi-user concurrency safety (invisible duplicate PR prevention), Codex TUI binary fix (npx fallback — "just works"), doctor command Codex diagnostics, `stdin: "ignore"` hang elimination, JSONL envelope parsing (richer agent output).  
**Previous review**: `38-end-user-experience-review-r9.md` (Score: 10/10)

---

## 1. Executive Summary

This round's changes are almost entirely **invisible to the user** — which is exactly right. Users don't see concurrency guards, stdin fixes, or envelope parsing. They see: (1) no more duplicate PRs when multiple OAC instances target the same repo, (2) Codex "just works" without manual binary management, (3) no more mysterious hangs. The best UX improvements are the ones users never notice because the problem simply doesn't occur.

**UX Score: 10/10** — Maintained. Critical multi-user blocker resolved. Codex setup friction eliminated.

---

## 2. Changes — UX Impact Assessment

| Change | UX Impact | Assessment |
|--------|-----------|-----------|
| Layer 1: Scanner filters claimed issues | ✅ **Invisible safety** — Users running OAC on the same repo never see issues that another OAC instance already claimed. No config needed. No UI indication needed (correct — absence of duplicates is the UX). |
| Layer 3: Pre-PR duplicate guard | ✅ **Invisible safety** — If Layer 1 misses (race condition), Layer 3 catches it before pushing. User sees a skip message in logs, not a failed PR. |
| Codex npx invocation | ✅ **Critical fix** — Users no longer need to know whether their Codex CLI is the npm package or the TUI binary. OAC handles it. Previous behavior: mysterious hang when using TUI binary. New behavior: works. |
| `stdin: "ignore"` everywhere | ✅ **Critical fix** — Eliminates an entire class of "OAC hangs and I don't know why" bugs. Users on various terminal configurations (tmux, screen, CI, cron) all benefit. |
| Codex `--json` flag | ✅ **Better output** — JSON mode produces structured events that OAC can parse reliably. Previous behavior: TUI escape sequences could corrupt output parsing. |
| Codex `--ephemeral` flag | ✅ **Clean state** — Each task gets a fresh Codex session. No risk of cross-task contamination. Users don't need to clear Codex state manually. |
| JSONL envelope parsing | Transparent — Users see richer file change and command execution events in OAC output/dashboard. |
| Doctor `checkCodexCli()` | ✅ **Clear diagnostics** — `oac doctor` now detects Codex TUI binary and suggests using the npm package. Actionable guidance. |

---

## 3. Multi-User Safety — UX Perspective

### Before (no concurrency guards):
```
# User A runs OAC on repo X, issue #42
[oac] Discovered issue #42 → working on it...
[oac] Created PR #100: [OAC] Fix issue #42

# User B runs OAC on repo X (same time)
[oac] Discovered issue #42 → working on it...
[oac] Created PR #101: [OAC] Fix issue #42  ← DUPLICATE
```

### After:
```
# User A runs OAC on repo X, issue #42
[oac] Discovered issue #42 → working on it...
[oac] Created PR #100: [OAC] Fix issue #42

# User B runs OAC on repo X (same time or later)
[oac] Scanning issues... (issue #42 filtered — already claimed by PR #100)
[oac] No actionable issues found.
```

The duplicate never appears. User B doesn't even see issue #42 in the list. This is the correct UX — **prevention is better than detection**. No user action required. No configuration. No "are you sure?" prompts.

---

## 4. Codex Setup UX — Before/After

### Before (TUI binary):
```
$ oac run --provider codex --repo owner/repo
[oac] Checking Codex availability...
█ (hangs forever — TUI binary waiting for terminal input)
```

### After (npx fallback):
```
$ oac run --provider codex --repo owner/repo
[oac] Checking Codex availability... ✓ (via npx @openai/codex)
[oac] Running Codex on issue #42...
```

### Doctor output (new):
```
$ oac doctor
✓ Node.js v24.0.0
✓ Claude Code CLI v1.2.3
✓ Codex CLI (via npx @openai/codex) v0.104.2
  ⚠ Note: bare `codex` binary is a TUI app. OAC uses npx for headless operation.
✓ OpenCode CLI v0.5.0
```

The warning is informational, not blocking. Users who installed Codex via Homebrew (TUI binary) still get a working OAC — no manual fix needed.

---

## 5. Previous Open Items

| Item | Status | Notes |
|------|--------|-------|
| Status watch flicker | ⚠️ Open (cosmetic) | Low priority terminal refresh issue |
| Config loading verbose message | ⚠️ Open (INFORMATIONAL) | Would help debug Node version issues |
| Provider auto-detection | ⚠️ Open (FUTURE) | Would improve first-run UX |

---

## 6. Recommendations

1. **Duplicate PR skip message** (INFORMATIONAL): When Layer 3 catches a duplicate, the skip message goes to logs. Consider a brief CLI-visible note: `Skipped issue #42 — already has an OAC PR (#100)`. Low priority since Layer 1 usually prevents this from being reached.

2. **npx progress indicator** (LOW): First `npx @openai/codex` invocation can take 2-5s with no output. Consider a spinner or "Resolving Codex package..." message during availability check.

---

## 7. Score Justification

The multi-user concurrency guard is the most significant UX improvement since the clone hang fix. It prevents a confusing, wasteful scenario (duplicate PRs) without any user configuration or action. The Codex TUI fix eliminates a "works on my machine" class of problems. `stdin: "ignore"` prevents mysterious hangs across all environments. All improvements are invisible — users simply don't encounter the problems anymore. That's the gold standard for UX.

**UX Score: 10 / 10** (maintained — critical multi-user blocker resolved, zero-friction Codex setup)

