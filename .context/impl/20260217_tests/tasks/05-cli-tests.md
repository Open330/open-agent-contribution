# Task: Write unit tests for packages/cli

## Goal
Create unit tests for `packages/cli`. Write test files in `packages/cli/tests/`.

## Test Framework
- Vitest (globals enabled)
- Import: `import { describe, it, expect, vi, beforeEach } from 'vitest';`
- Import source using relative paths

## Files to Test

### 1. `packages/cli/tests/doctor.test.ts` — Test doctor command helpers

The doctor.ts file has several pure helper functions that can be tested. Since they're not exported, we need to test through the command or extract testable logic.

Focus on testing the pure functions by importing the module and testing the command behavior:

Test `isVersionAtLeast` logic (test through doctor command behavior, or duplicate the logic for unit testing):
- `24.0.0` >= `24.0.0` → true
- `24.1.0` >= `24.0.0` → true
- `23.9.9` >= `24.0.0` → false
- `24.0.1` >= `24.0.0` → true
- `22.0.0` >= `24.0.0` → false

Test `extractVersion` logic:
- `"v24.0.0"` → `"v24.0.0"`
- `"git version 2.43.0"` → `"v2.43.0"`
- `"Claude Code v1.0.16"` → `"v1.0.16"`
- `"no version here"` → `undefined`
- `""` → `undefined`

Test `maskToken` logic:
- Short token `"abc"` → `"ab****"`
- Long token `"ghp_abcd1234xy"` → `"ghp_****xy"`

Since these are private functions, create a separate test that reimplements or tests the doctor command output:

```typescript
import { createDoctorCommand } from '../src/commands/doctor.js';

describe('createDoctorCommand', () => {
  it('returns a Commander Command instance', () => {
    const cmd = createDoctorCommand();
    expect(cmd.name()).toBe('doctor');
  });
});
```

### 2. `packages/cli/tests/cli.test.ts` — Test CLI setup

```typescript
import { createCli } from '../src/cli.js';

describe('createCli', () => {
  it('returns a Commander program with expected commands', () => {
    const program = createCli();
    const commandNames = program.commands.map(cmd => cmd.name());
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('scan');
    expect(commandNames).toContain('plan');
    expect(commandNames).toContain('run');
  });

  it('has global options --config, --verbose, --json, --no-color', () => {
    const program = createCli();
    const optionNames = program.options.map(opt => opt.long);
    expect(optionNames).toContain('--config');
    expect(optionNames).toContain('--verbose');
    expect(optionNames).toContain('--json');
    expect(optionNames).toContain('--no-color');
  });
});
```

## Important Notes
- Target: 10-20 tests
- CLI tests should NOT actually execute commands (mock process.exit, console.log)
- Focus on testing the command registration and structure
- Use `vi.spyOn(console, 'log')` and `vi.spyOn(process, 'exit')` for command output testing
- Keep tests fast and isolated
