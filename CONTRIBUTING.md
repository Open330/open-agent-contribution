# Contributing to Open Agent Contribution (OAC)

Thank you for your interest in contributing to OAC! This guide will help you get started.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Changesets](#changesets)
- [Pull Request Guidelines](#pull-request-guidelines)

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** >= 24.0.0 (we recommend using [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm))
- **pnpm** >= 9 (installed automatically via corepack or `npm install -g pnpm`)
- **git**

Verify your setup:

```bash
node --version   # v24.x.x or higher
pnpm --version   # 9.x.x or higher
git --version
```

## Setup

1. **Fork the repository** on GitHub.

2. **Clone your fork** locally:

   ```bash
   git clone https://github.com/<your-username>/open-agent-contribution.git
   cd open-agent-contribution
   ```

3. **Install dependencies:**

   ```bash
   pnpm install
   ```

4. **Build all packages:**

   ```bash
   pnpm build
   ```

5. **Verify everything works:**

   ```bash
   pnpm test
   pnpm lint
   pnpm typecheck
   ```

## Development Workflow

This monorepo uses [Turborepo](https://turbo.build/) to orchestrate builds and tasks across packages.

### Common Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `pnpm build`         | Build all packages                     |
| `pnpm dev`           | Start all packages in development mode |
| `pnpm test`          | Run tests across all packages          |
| `pnpm test:coverage` | Run tests with coverage reporting      |
| `pnpm lint`          | Lint all files with Biome              |
| `pnpm lint:fix`      | Lint and auto-fix issues               |
| `pnpm format`        | Format all files with Biome            |
| `pnpm typecheck`     | Run TypeScript type checking           |
| `pnpm clean`         | Clean all build artifacts              |

### Working on a Specific Package

Turborepo supports filtering by package name:

```bash
pnpm turbo run build --filter=@oac/core
pnpm turbo run test --filter=@oac/core
```

### Branching

- Create a feature branch from `main`:
  ```bash
  git checkout -b feat/my-feature
  ```
- Use descriptive branch names: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`.

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. There is no separate Prettier or ESLint configuration.

- **Lint:** `pnpm lint`
- **Auto-fix:** `pnpm lint:fix`
- **Format:** `pnpm format`

Key conventions:

- Use TypeScript for all source code.
- Prefer `const` over `let`; avoid `var`.
- Use explicit return types on exported functions.
- Keep files focused -- one module per file when practical.

Your editor should pick up the `biome.json` at the repository root automatically. Install the [Biome extension](https://biomejs.dev/guides/editors/first-party-extensions/) for your editor for real-time feedback.

## Testing

We use [Vitest](https://vitest.dev/) as the test runner.

- Place tests in a `tests/` directory alongside the package `src/`.
- Name test files with the `.test.ts` suffix.
- Run all tests: `pnpm test`
- Run tests for a single package: `pnpm turbo run test --filter=@oac/core`
- Run tests in watch mode within a package directory: `pnpm vitest`

Write tests for:

- New features (unit tests at minimum).
- Bug fixes (regression tests that reproduce the bug).
- Edge cases and error handling.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

If your change affects any published package, add a changeset before opening your PR:

```bash
pnpm changeset
```

Follow the prompts to select the affected packages and describe the change. This creates a markdown file in the `.changeset/` directory -- commit it with your PR.

- **patch** -- bug fixes, minor internal changes
- **minor** -- new features, non-breaking additions
- **major** -- breaking changes

If your change is documentation-only or does not affect published packages, no changeset is needed.

## Pull Request Guidelines

1. **Fill out the PR template** completely.
2. **Keep PRs focused.** One logical change per PR.
3. **Ensure CI passes.** All checks (lint, typecheck, test) must be green.
4. **Add a changeset** if your change affects a published package.
5. **Write clear commit messages.** Use conventional commit style:
   - `feat: add new parser API`
   - `fix: handle null input in validator`
   - `docs: update contributing guide`
   - `test: add coverage for edge cases`
6. **Update documentation** if your change affects public APIs.
7. **Request a review** from at least one maintainer.
8. **Be responsive** to review feedback.

### PR Checklist

- [ ] I have read the contributing guide.
- [ ] My code follows the project code style (Biome passes).
- [ ] I have added tests for my changes.
- [ ] All new and existing tests pass.
- [ ] I have added a changeset (if applicable).
- [ ] I have updated relevant documentation (if applicable).

---

Thank you for contributing! If you have questions, feel free to open a discussion or issue.
