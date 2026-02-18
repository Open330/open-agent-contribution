# Task: Replace `spawn` with `execa` in doctor.ts (T2-3)

## Overview
Replace the manual `child_process.spawn` implementation in `doctor.ts` with `execa`, matching the rest of the codebase's convention.

## File: `src/cli/commands/doctor.ts`

### Current code — manual spawn implementation (~50 lines):
```typescript
import { spawn } from "node:child_process";

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

    child.once("error", (error) => {
      if (resolved) return;
      resolved = true;
      const errorWithCode = error as NodeJS.ErrnoException;
      resolvePromise({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        errorCode: errorWithCode.code,
        errorMessage: error.message,
      });
    });

    child.once("close", (exitCode) => {
      if (resolved) return;
      resolved = true;
      resolvePromise({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}
```

### Fix — replace with execa:
```typescript
import { execa } from "execa";

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execa(command, args, {
      reject: false,
      timeout: 30_000,
      stdin: "ignore",
    });

    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      errorCode: nodeError.code,
      errorMessage: nodeError.message,
    };
  }
}
```

Key improvements:
- Uses `execa` like all other modules in the codebase
- Adds 30s timeout (missing from original)
- `reject: false` prevents throwing on non-zero exit
- Catches spawn errors (e.g., command not found → ENOENT)
- Much simpler code (~20 lines vs ~50 lines)

### Import changes:
- Remove: `import { spawn } from "node:child_process";`
- Add: `import { execa } from "execa";`

### Interface:
Keep the existing `CommandResult` interface unchanged. The `errorCode` and `errorMessage` fields are optional and only populated on spawn errors.

## Verification
- Run `pnpm build` to ensure no type errors
- Run `oac doctor` to verify all checks still pass
- Verify `execa` is already in package.json dependencies

## MUST NOT
- Change the `CommandResult` interface
- Change what the doctor checks evaluate
- Change any other file
- Add new dependencies (execa is already installed)

