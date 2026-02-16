# Task: Create CI/CD GitHub Actions workflows

## Goal
Create GitHub Actions workflows for the OAC monorepo.

## Files to Create

### .github/workflows/ci.yml
- Trigger: push to main, pull_request to main
- Jobs:
  1. **lint** - Run `pnpm lint` (biome)
  2. **typecheck** - Run `pnpm typecheck` (tsc --noEmit)
  3. **test** - Run `pnpm test` with coverage, matrix: [node 22, node 23]
- Use pnpm/action-setup@v4 for pnpm
- Cache: pnpm store
- Node setup: actions/setup-node@v4

### .github/workflows/release.yml
- Trigger: push to main (only when changesets exist)
- Uses changesets/action@v1 for automated npm publishing
- Creates GitHub releases

### .github/workflows/dogfood.yml
- Trigger: schedule (weekly, Saturday 00:00 UTC)
- Run OAC against itself: `oac scan --repo Open330/open-agent-contribution --format json`
- Upload scan results as artifact

## Also Create
- `.github/ISSUE_TEMPLATE/bug_report.yml` - Bug report template
- `.github/ISSUE_TEMPLATE/feature_request.yml` - Feature request template
- `.github/pull_request_template.md` - PR template with checklist
