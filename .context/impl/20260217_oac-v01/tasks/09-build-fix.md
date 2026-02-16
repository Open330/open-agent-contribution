# Task: pnpm install + build + fix all TypeScript errors

## Goal
Make the entire monorepo compile successfully with zero TypeScript errors.

## Steps

1. Run `pnpm install` at the repo root
2. Run `pnpm build` (via turborepo)
3. Fix ALL TypeScript compilation errors across all packages
4. Common issues to expect and fix:
   - Missing `.js` extensions on relative imports (ESM requires them)
   - Cross-package type mismatches (packages were written independently)
   - Missing type exports from @oac/core that other packages expect
   - Import paths that don't match actual exports
   - `verbatimModuleSyntax` violations (use `import type` for type-only imports)
5. After fixing, run `pnpm build` again to verify zero errors
6. Run `pnpm typecheck` to double-check

## Important
- Fix errors IN PLACE - edit the source files directly
- Do NOT change the architecture or logic, only fix compilation issues
- Start with packages/core (foundation), then repo, discovery, budget, tracking, execution, completion, cli
- Each package's tsconfig.json extends ../../tsconfig.base.json
