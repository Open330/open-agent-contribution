# OAC Configuration Reference

> Auto-generated from the Zod schema in `src/core/config.ts`.
> Version: **2026.4.2**

OAC is configured via an `oac.config.ts` (or `.js` / `.json`) file at the project root. Use `defineConfig()` for type-safe authoring:

```ts
import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: ["facebook/react"],
  budget: { totalTokens: 50_000 },
  execution: { concurrency: 3, mode: "new-pr" },
});
```

Environment variables can be interpolated with `${VAR_NAME}` syntax anywhere a string value is accepted.

---

## `repos`

Target repositories to contribute to.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `repos` | `Array<string \| { name, branch? }>` | `[]` | List of repos. Each entry is either a GitHub slug (`"owner/repo"`) or an object with `name` (required) and `branch` (optional). |

```ts
repos: [
  "facebook/react",
  { name: "vercel/next.js", branch: "canary" },
]
```

---

## `provider`

AI agent provider configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `provider.id` | `string` | `"claude-code"` | Provider identifier. |
| `provider.options` | `Record<string, unknown>` | `{}` | Provider-specific options passed through to the agent. |

---

## `budget`

Token budget controls.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `budget.totalTokens` | `integer` | `100000` | Maximum tokens to spend across all tasks. Must be positive. |
| `budget.reservePercent` | `number` | `0.1` | Fraction of budget to reserve for retries/overhead (0–1). |
| `budget.estimationPadding` | `number` | `1.2` | Multiplier applied to token estimates for safety margin. Must be positive. |

---

## `discovery`

Task discovery and scanning settings.

### `discovery.scanners`

Toggle individual scanners on or off.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `discovery.scanners.lint` | `boolean` | `true` | Scan for lint warnings and errors. |
| `discovery.scanners.todo` | `boolean` | `true` | Scan for TODO/FIXME/HACK comments. |
| `discovery.scanners.testGap` | `boolean` | `true` | Scan for files missing test coverage. |
| `discovery.scanners.deadCode` | `boolean` | `false` | Scan for dead/unused code. |
| `discovery.scanners.githubIssues` | `boolean` | `true` | Fetch open GitHub issues matching labels. |

### Other discovery options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `discovery.issueLabels` | `string[]` | `["good-first-issue", "help-wanted", "bug"]` | GitHub issue labels to match. |
| `discovery.minPriority` | `integer` | `20` | Minimum priority score (0–100) for a task to be included. |
| `discovery.maxTasks` | `integer` | `50` | Maximum number of tasks to discover. Must be positive. |
| `discovery.customScanners` | `string[]` | `[]` | Paths to custom scanner modules. |
| `discovery.exclude` | `string[]` | `["node_modules", "dist", "build", ".git", "*.min.js", "vendor/"]` | Glob patterns to exclude from scanning. |

---

## `execution`

Task execution settings.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `execution.concurrency` | `integer` | `2` | Max parallel task executions. Must be positive. |
| `execution.taskTimeout` | `integer` | `300` | Timeout per task in seconds. Must be positive. |
| `execution.maxRetries` | `integer` | `2` | Max retry attempts for failed tasks (0 = no retries). |
| `execution.mode` | `"new-pr" \| "update-pr" \| "direct-commit"` | `"new-pr"` | How to submit completed work. |
| `execution.branchPattern` | `string` | `"oac/{date}/{task}"` | Branch naming pattern. `{date}` and `{task}` are interpolated. |

### `execution.validation`

Post-execution validation checks.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `execution.validation.lint` | `boolean` | `true` | Run linter after task completion. |
| `execution.validation.test` | `boolean` | `true` | Run tests after task completion. |
| `execution.validation.typeCheck` | `boolean` | `true` | Run type checker after task completion. |
| `execution.validation.maxDiffLines` | `integer` | `500` | Reject diffs exceeding this line count. Must be positive. |

### `execution.pr`

Pull request settings.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `execution.pr.draft` | `boolean` | `false` | Create PRs as drafts. |
| `execution.pr.labels` | `string[]` | `["oac-contribution"]` | Labels to apply to created PRs. |
| `execution.pr.reviewers` | `string[]` | `[]` | GitHub usernames to request as reviewers. |
| `execution.pr.assignees` | `string[]` | `[]` | GitHub usernames to assign to the PR. |

---

## `completion`

Post-PR completion and monitoring.

### `completion.integrations.linear`

Linear issue tracker integration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `completion.integrations.linear.enabled` | `boolean` | `false` | Enable Linear integration. |
| `completion.integrations.linear.apiKey` | `string` | — | Linear API key. **Required** when `enabled: true`. Supports `${ENV_VAR}` syntax. |
| `completion.integrations.linear.teamId` | `string` | — | Linear team ID. **Required** when `enabled: true`. |

### `completion.integrations.jira`

Jira issue tracker integration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `completion.integrations.jira.enabled` | `boolean` | `false` | Enable Jira integration. |
| `completion.integrations.jira.baseUrl` | `string (URL)` | — | Jira instance URL. **Required** when `enabled: true`. |
| `completion.integrations.jira.email` | `string` | — | Jira account email. **Required** when `enabled: true`. |
| `completion.integrations.jira.apiToken` | `string` | — | Jira API token. **Required** when `enabled: true`. Supports `${ENV_VAR}` syntax. |
| `completion.integrations.jira.projectKey` | `string` | — | Jira project key. **Required** when `enabled: true`. |

### `completion.monitor`

PR monitoring settings.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `completion.monitor.enabled` | `boolean` | `false` | Enable post-PR monitoring. |
| `completion.monitor.pollInterval` | `integer` | `300` | Seconds between status checks. Must be positive. |
| `completion.monitor.autoRespondToReviews` | `boolean` | `false` | Automatically respond to review comments. |
| `completion.monitor.autoDeleteBranch` | `boolean` | `true` | Delete branch after PR is merged. |

---

## `tracking`

Local state tracking.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tracking.directory` | `string` | `".oac"` | Directory for local OAC state files. |
| `tracking.autoCommit` | `boolean` | `false` | Auto-commit tracking changes to git. |
| `tracking.gitTracked` | `boolean` | `true` | Include tracking directory in git. |

---

## `dashboard`

Local dashboard server.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `dashboard.port` | `integer` | `3141` | Port for the dashboard server (1–65535). |
| `dashboard.openBrowser` | `boolean` | `true` | Automatically open the dashboard in a browser. |

---

## `analyze`

Context analysis settings for `oac analyze` / auto-analysis before `oac run`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `analyze.autoAnalyze` | `boolean` | `true` | Auto-run analysis before `oac run` if context is stale or missing. |
| `analyze.staleAfterMs` | `integer` | `86400000` | Max age in milliseconds before context is considered stale (default: 24 hours). |
| `analyze.contextDir` | `string` | `".oac/context"` | Directory for persisted analysis context, relative to repo root. |

---

## Environment Variable Interpolation

Any string value in the config supports `${VAR_NAME}` interpolation:

```ts
export default defineConfig({
  completion: {
    integrations: {
      linear: {
        enabled: true,
        apiKey: "${LINEAR_API_KEY}",
        teamId: "${LINEAR_TEAM_ID}",
      },
    },
  },
});
```

If a referenced variable is not set, OAC throws a `CONFIG_SECRET_MISSING` error with the variable name and config path.

---

## Minimal Example

```ts
import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: ["my-org/my-repo"],
});
```

All other options use sensible defaults. See individual sections above for default values.

## Full Example

```ts
import { defineConfig } from "@open330/oac";

export default defineConfig({
  repos: [
    "facebook/react",
    { name: "vercel/next.js", branch: "canary" },
  ],
  provider: { id: "claude-code" },
  budget: {
    totalTokens: 200_000,
    reservePercent: 0.15,
    estimationPadding: 1.3,
  },
  discovery: {
    scanners: { lint: true, todo: true, testGap: true, deadCode: true, githubIssues: true },
    issueLabels: ["good-first-issue", "help-wanted"],
    minPriority: 30,
    maxTasks: 25,
    exclude: ["node_modules", "dist", "vendor/", "**/*.generated.ts"],
  },
  execution: {
    concurrency: 4,
    taskTimeout: 600,
    maxRetries: 1,
    mode: "new-pr",
    branchPattern: "oac/{date}/{task}",
    validation: { lint: true, test: true, typeCheck: true, maxDiffLines: 800 },
    pr: { draft: true, labels: ["oac-contribution", "automated"], reviewers: ["maintainer"] },
  },
  tracking: { directory: ".oac", autoCommit: true },
  dashboard: { port: 3141 },
  analyze: { autoAnalyze: true, staleAfterMs: 43_200_000 },
});
```

