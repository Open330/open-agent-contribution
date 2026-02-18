**Summary of changes**
- Adds 4 new unit test files for `@open330/oac-budget`:
  - `claude-counter.test.ts` for `ClaudeTokenCounter`
  - `codex-counter.test.ts` for `CodexTokenCounter`
  - `complexity.test.ts` for `estimateLocChanges` and `analyzeTaskComplexity`
  - `estimator.test.ts` for `estimateTokens` (provider selection, feasibility, confidence behavior, file handling)
- Expands coverage beyond existing `packages/budget/tests/planner.test.ts`.

**Code quality assessment**
- LGTM

**Specific issues found**
- No blocking or correctness issues found in the diff.
- Residual risk (non-blocking): counter tests touch real `tiktoken` behavior, so they are closer to integration tests than pure unit tests.

**Verdict**
- APPROVE