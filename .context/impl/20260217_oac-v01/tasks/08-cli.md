# Task: Implement packages/cli

## Context
Read `.context/plans/20260217_oac-service-plan/codex.md` section 2 for CLI command tree.
Read `.context/plans/20260217_oac-service-plan/claude.md` section 11 for CLI architecture.
Read `.context/plans/20260217_oac-service-plan/gemini.md` sections 2-4 for UX patterns.

## Deliverables

Implement in `packages/cli/src/`:

### 1. `cli.ts` — Main CLI Entry Point
- Use Commander.js to define the program
- Name: 'oac', version from package.json
- Global options: --config, --verbose, --json, --no-color
- Register all subcommands

### 2. `commands/init.ts` — `oac init`
- Interactive wizard using @inquirer/prompts
- Steps: welcome (ASCII logo), provider selection, budget config, first repo URL, generate oac.config.ts
- Write oac.config.ts to current directory using defineConfig from @oac/core

### 3. `commands/doctor.ts` — `oac doctor`
- Check Node.js version >= 22
- Check git is installed
- Check GitHub auth (gh auth status or GITHUB_TOKEN)
- Check agent CLIs availability (claude --version, codex --version)
- Display results with chalk (green check / red x)

### 4. `commands/scan.ts` — `oac scan`
- Options: --repo, --scanners, --min-priority, --format (table|json)
- Use @oac/repo to resolve repo
- Use @oac/discovery to scan
- Display results in cli-table3 table (ID, Title, Source, Priority, Complexity)

### 5. `commands/plan.ts` — `oac plan`
- Options: --repo, --tokens, --provider
- Run scan + budget estimation
- Show execution plan: selected tasks with token costs, deferred tasks, budget summary
- Display as table with ora spinner during estimation

### 6. `commands/run.ts` — `oac run`
- Options: --repo, --tokens, --provider, --concurrency, --dry-run, --mode, --max-tasks, --timeout
- Full pipeline: resolve repo → scan → estimate → select → execute → complete → track
- Use ora for progress, chalk for status messages
- Show final summary: tasks completed, PRs created, tokens used

### 7. `index.ts` — bin entry point
- #!/usr/bin/env node
- Import and run cli.ts

## Dependencies
- All @oac/* workspace packages
- commander ^13.1.0
- chalk ^5.4.1
- ora ^8.1.1
- cli-table3 ^0.6.5
- @inquirer/prompts ^6.0.0

## UX Guidelines (from Gemini)
- Dark-mode-friendly colors (green=success, red=error, yellow=warning, blue=info)
- Spinners for async operations
- Tables for structured data
- --json flag outputs machine-readable JSON
- --no-color respects NO_COLOR env var
