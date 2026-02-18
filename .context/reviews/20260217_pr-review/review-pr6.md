**Summary of changes**
- `packages/dashboard/src/ui.ts:143` changes the source filter option label from `TODO comments` to `To-do comments`.
- The option key remains `value="todo"` (no data/behavior contract change).

**Code quality assessment**
- No correctness issues found.
- No functional regression expected since only display text changed.
- Minor non-blocking note: `TODO` is the common technical term; `To-do` is a copy/style choice.
- No tests needed for this UI text-only change.

**Verdict**
- **APPROVE**