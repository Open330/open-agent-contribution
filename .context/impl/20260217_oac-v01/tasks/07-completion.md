# Task: Implement packages/completion

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` section 8 for architecture.
Read `packages/core/src/types.ts` for shared types.

## Deliverables

Implement in `packages/completion/src/`:

### 1. `types.ts` — Completion Types
- `PRCreationParams`: repo, task, result, branchName, baseBranch
- `CreatedPR`: number, url, sha
- `CompletionResult`: prUrl?, commitSha?, summary, filesChanged, tokensUsed
- `ExternalTaskRef`: provider, externalId, url?
- `ProjectManagementProvider` interface: ping(), notifyStarted(), notifyPRCreated(), notifyCompleted(), notifyFailed()

### 2. `github-pr.ts` — PR Creation
- `createPR(params: PRCreationParams, octokit: Octokit): Promise<CreatedPR>`
- Push the branch via simple-git
- Create PR via octokit.pulls.create with title `[OAC] {task.title}`
- Add labels: 'oac-contribution', task.source
- Build PR body from template with: summary, diff stats, context (agent, tokens, duration), linked issue (Fixes #N)

### 3. `issue-linker.ts` — Issue Linker
- `linkIssueToePR(repo, task, pr, octokit): Promise<void>`
- If task has linkedIssue, add comment on issue referencing the PR
- Handle already-closed issues gracefully

### 4. `diff-validator.ts` — Diff Validation
- `validateDiff(repoPath, config): Promise<ValidationResult>`
- Check diff size (maxDiffLines, default 500)
- Check for forbidden patterns (eval(), child_process, etc.)
- Check for protected files (.env*, *.pem, *.key)
- Return { valid, warnings, errors }

### 5. `handler.ts` — Completion Handler (orchestrator)
- `CompletionHandler` class
- Pipeline: validateDiff → pushBranch → createPR → linkIssue → notifyWebhooks
- Emit events to OacEventBus
- Handle errors at each step gracefully

### 6. `index.ts` — Re-export

## Dependencies
- @oac/core (workspace:*)
- @octokit/rest ^21.1.1
- simple-git ^3.27.0
