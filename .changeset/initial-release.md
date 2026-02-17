---
"@open330/oac-core": minor
"@open330/oac-repo": minor
"@open330/oac-discovery": minor
"@open330/oac-budget": minor
"@open330/oac-execution": minor
"@open330/oac-completion": minor
"@open330/oac-tracking": minor
"@open330/oac": minor
"@open330/oac-dashboard": minor
---

Initial public release of all OAC packages.

Features:
- Full OAC pipeline: scan repos for tasks, estimate tokens, execute with AI agents, create PRs
- CLI with `oac run`, `oac scan`, `oac plan`, `oac doctor` commands
- Web dashboard with real-time SSE streaming and Start Run UI
- Unlimited token budget mode (runs until rate-limited)
- Parallel task execution with configurable concurrency
- Contribution tracking and leaderboard
