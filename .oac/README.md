# OAC — Contribution Guide for OAC Agents

OAC (Open Agent Contribution) is a CLI tool that uses spare AI tokens to auto-contribute to open source repos. TypeScript, Node.js 20+, ESM, single package published to npm as `@open330/oac`.

## Project Overview

- **Language**: TypeScript 5.7+ (strict mode)
- **Runtime**: Node.js >= 20, ESM only
- **Package manager**: pnpm
- **Build**: tsup
- **Test**: Vitest
- **Lint/Format**: Biome
- **CI checks**: `pnpm lint`, `pnpm typecheck`, `pnpm test`

## Module Architecture

```
src/
  core/        — Event bus, config (Zod schema), types, errors, memory monitoring
  repo/        — GitHub repo resolution, shallow cloning, metadata cache
  discovery/   — Codebase analyzer, epic grouper, scanners (lint, TODO, test-gap, issues)
  budget/      — Token estimation (tiktoken), complexity analysis, execution planner
  execution/   — Agent adapters (Claude Code, Codex), worktree sandbox, worker
  completion/  — PR creation (Octokit), diff validation, issue linking
  tracking/    — Contribution logs, leaderboard, JSON schema
  cli/         — 11 commands (init, doctor, analyze, scan, plan, run, status, log, leaderboard, completion, explain)
  dashboard/   — Fastify + embedded SPA with SSE streaming
```

## Contribution Workflow

### Step 1: Understand the Codebase

Read these key files first:

1. `README.md` — full feature list, architecture diagram, module descriptions
2. `package.json` — dependencies, scripts, build config
3. `src/core/config.ts` — Zod config schema (central to everything)
4. `src/core/types.ts` — shared type definitions
5. `src/cli/commands/run/` — the main `oac run` pipeline (8 sub-modules)

### Step 2: Find Work

Look for actionable improvements:

- **GitHub Issues**: Check open issues at `github.com/Open330/open-agent-contribution/issues`
- **TODOs in code**: Search for `TODO`, `FIXME`, `HACK` comments in `src/`
- **Test gaps**: Look for untested modules or low-coverage areas
- **Lint warnings**: Run `pnpm lint` and fix any reported issues
- **Type errors**: Run `pnpm typecheck` and fix strictness issues

### Step 3: Implement

Make your changes following the conventions below, then verify:

```bash
pnpm build        # Must compile cleanly
pnpm test         # All tests must pass
pnpm lint         # No lint errors
pnpm typecheck    # No type errors
```

### Step 4: Commit and Push

Push directly to `main`. We are a fast-moving team — commit to main first, fix forward if anything breaks.

```bash
git add <files>
git commit -m "description of change"
git push origin main
```

Do NOT create pull requests. Do NOT create feature branches.

## Coding Conventions

- **ESM only** — use `import`/`export`, no CommonJS
- **Strict TypeScript** — no `any`, no `as` casts unless absolutely necessary
- **Zod for validation** — config and external input validated with Zod schemas
- **Error handling** — use typed error classes from `src/core/errors.ts`
- **Async/await** — no raw Promise chains
- **File naming** — kebab-case (`epic-grouper.ts`, `token-counter.ts`)
- **One concern per file** — keep modules focused
- **Tests** — colocate tests in `__tests__/` or `*.test.ts` files, use Vitest
- **Imports** — relative imports within the project, no path aliases

## Scope Guidelines

**Good targets:**
- Bug fixes in any module
- Test coverage improvements
- Performance optimizations (especially in discovery/analyzer)
- New scanner types in `src/discovery/`
- CLI UX improvements
- Documentation fixes
- Error message improvements

**Off-limits (do not modify without explicit permission):**
- `package.json` version field
- `.github/workflows/` CI configuration
- Publishing/release scripts
- License files

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `@octokit/rest` | GitHub API |
| `execa` | Child process (agent execution) |
| `p-queue` | Bounded concurrency |
| `tiktoken` | Token counting |
| `zod` | Schema validation |
| `chalk` / `ora` | Terminal output |
| `fastify` | Dashboard server |
| `vitest` | Testing |
| `biome` | Lint + format |
