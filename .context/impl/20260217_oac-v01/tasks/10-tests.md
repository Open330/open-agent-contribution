# Task: Write unit tests for core, budget, and tracking packages

## Goal
Write comprehensive unit tests achieving 80% coverage for the three most testable packages.

## Test Files to Create

### packages/core/tests/
- `event-bus.test.ts` - Test createEventBus, emit/on for all event types
- `config.test.ts` - Test loadConfig with defaults, env var interpolation, validation errors
- `errors.test.ts` - Test OacError creation, error factory functions, error codes
- `types.test.ts` - Test type guards if any

### packages/budget/tests/
- `estimator.test.ts` - Test token estimation for different complexities, padding
- `complexity.test.ts` - Test complexity analysis for different task types
- `planner.test.ts` - Test knapsack selection, budget reserve, edge cases (empty tasks, budget=0)

### packages/tracking/tests/
- `log-schema.test.ts` - Test zod schema validation, valid/invalid logs
- `logger.test.ts` - Test writeContributionLog (mock fs), filename format YYYY-MM-DD-HHmmss-user.json
- `leaderboard.test.ts` - Test aggregation, empty dir, multiple users

## Tech
- Vitest with `describe`/`it`/`expect`
- Use `vi.mock()` for filesystem mocks
- Use `vi.fn()` for function mocks
- Import from the package source directly (e.g., `../src/event-bus.js`)
