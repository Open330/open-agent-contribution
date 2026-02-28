import { type ChildProcess, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  type AgentProviderId,
  OacError,
  type TokenEstimate,
  executionError,
} from "../../core/index.js";

import type {
  AgentAvailability,
  AgentEvent,
  AgentExecuteParams,
  AgentExecution,
  AgentProvider,
  AgentResult,
  TokenEstimateParams,
} from "./agent.interface.js";
import {
  AsyncEventQueue,
  type TokenPatch,
  type TokenState,
  isRecord,
  readNumber,
  readString,
} from "./shared.js";

type RunningProcess = ChildProcess;

interface ProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface CommandResult extends ProcessExit {
  stdout: string;
  stderr: string;
  error?: unknown;
}

function parseJsonPayload(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const fragment = trimmed.slice(start, end + 1);
    if (fragment !== trimmed) {
      candidates.push(fragment);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // best-effort: agent output may not be valid JSON
    }
  }

  return undefined;
}

function parseTokenPatchFromPayload(payload: Record<string, unknown>): TokenPatch {
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  return {
    inputTokens: readNumber(
      payload.inputTokens ??
        payload.input_tokens ??
        payload.promptTokens ??
        payload.prompt_tokens ??
        usage?.inputTokens ??
        usage?.input_tokens ??
        usage?.promptTokens ??
        usage?.prompt_tokens,
    ),
    outputTokens: readNumber(
      payload.outputTokens ??
        payload.output_tokens ??
        payload.completionTokens ??
        payload.completion_tokens ??
        usage?.outputTokens ??
        usage?.output_tokens ??
        usage?.completionTokens ??
        usage?.completion_tokens,
    ),
    cumulativeTokens: readNumber(
      payload.cumulativeTokens ??
        payload.cumulative_tokens ??
        payload.totalTokens ??
        payload.total_tokens ??
        usage?.cumulativeTokens ??
        usage?.cumulative_tokens ??
        usage?.totalTokens ??
        usage?.total_tokens,
    ),
  };
}

function patchTokenState(state: TokenState, patch: TokenPatch): AgentEvent | undefined {
  if (
    patch.inputTokens === undefined &&
    patch.outputTokens === undefined &&
    patch.cumulativeTokens === undefined
  ) {
    return undefined;
  }

  state.inputTokens = patch.inputTokens ?? state.inputTokens;
  state.outputTokens = patch.outputTokens ?? state.outputTokens;
  const computedTotal = state.inputTokens + state.outputTokens;
  state.cumulativeTokens = Math.max(
    state.cumulativeTokens,
    patch.cumulativeTokens ?? computedTotal,
  );

  return {
    type: "tokens",
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cumulativeTokens: state.cumulativeTokens,
  };
}

function parseTokenEvent(
  line: string,
  payload: Record<string, unknown> | undefined,
  state: TokenState,
): AgentEvent | undefined {
  if (payload) {
    return patchTokenState(state, parseTokenPatchFromPayload(payload));
  }

  const inputMatch = line.match(/(?:input|prompt)\s*tokens?\s*[:=]\s*(\d+)/i);
  const outputMatch = line.match(/(?:output|completion)\s*tokens?\s*[:=]\s*(\d+)/i);
  const totalMatch = line.match(/(?:total|cumulative|used)\s*tokens?\s*[:=]\s*(\d+)/i);

  return patchTokenState(state, {
    inputTokens: inputMatch ? Number.parseInt(inputMatch[1], 10) : undefined,
    outputTokens: outputMatch ? Number.parseInt(outputMatch[1], 10) : undefined,
    cumulativeTokens: totalMatch ? Number.parseInt(totalMatch[1], 10) : undefined,
  });
}

function normalizeFileAction(value: unknown): "create" | "modify" | "delete" | undefined {
  if (value !== "create" && value !== "modify" && value !== "delete") {
    return undefined;
  }
  return value;
}

function parseFileEditFromPayload(
  payload: Record<string, unknown>,
): Extract<AgentEvent, { type: "file_edit" }> | undefined {
  if (payload.type === "file_edit") {
    const action = normalizeFileAction(payload.action);
    const path = readString(payload.path);
    if (action && path) {
      return {
        type: "file_edit",
        action,
        path,
      };
    }
  }

  // Codex-style JSON envelope: {"type":"item.completed","item":{"type":"file_change",...}}
  if (payload.type === "item.completed") {
    const item = isRecord(payload.item) ? payload.item : undefined;
    if (item?.type === "file_change") {
      const action = normalizeFileAction(item.action) ?? "modify";
      const path = readString(item.path ?? item.filename);
      if (path) {
        return { type: "file_edit", action, path };
      }
    }
  }

  const tool = readString(payload.tool ?? payload.tool_name ?? payload.name);
  const input = isRecord(payload.input) ? payload.input : undefined;
  const inputPath = readString(input?.path ?? input?.file_path ?? input?.filePath);
  if (!tool || !inputPath) {
    return undefined;
  }

  if (tool === "create_file") {
    return { type: "file_edit", action: "create", path: inputPath };
  }
  if (tool === "delete_file") {
    return { type: "file_edit", action: "delete", path: inputPath };
  }
  if (tool === "write_file" || tool === "edit_file" || tool === "replace_file") {
    return { type: "file_edit", action: "modify", path: inputPath };
  }

  return undefined;
}

function parseFileEditFromLine(
  line: string,
): Extract<AgentEvent, { type: "file_edit" }> | undefined {
  const fileActionMatch = line.match(/\b(created|modified|deleted)\s+(?:file\s+)?([^\s"'`]+)/i);
  if (!fileActionMatch) {
    return undefined;
  }

  const actionMap: Record<string, "create" | "modify" | "delete"> = {
    created: "create",
    modified: "modify",
    deleted: "delete",
  };

  const action = actionMap[fileActionMatch[1].toLowerCase()];
  const path = fileActionMatch[2]?.trim().replace(/[.,:;!?]+$/u, "");
  if (!action || !path) {
    return undefined;
  }

  return {
    type: "file_edit",
    action,
    path,
  };
}

function parseFileEditEvent(
  line: string,
  payload: Record<string, unknown> | undefined,
): Extract<AgentEvent, { type: "file_edit" }> | undefined {
  if (payload) {
    return parseFileEditFromPayload(payload);
  }

  return parseFileEditFromLine(line);
}

function parseToolUseFromPayload(
  payload: Record<string, unknown>,
): Extract<AgentEvent, { type: "tool_use" }> | undefined {
  // Codex-style JSON envelope: {"type":"item.completed","item":{"type":"command_execution","command":"..."}}
  if (payload.type === "item.completed") {
    const item = isRecord(payload.item) ? payload.item : undefined;
    if (item?.type === "command_execution") {
      const command = readString(item.command);
      if (command) {
        return { type: "tool_use", tool: "shell", input: { command } };
      }
    }
  }

  const tool = readString(payload.tool ?? payload.tool_name ?? payload.name);
  if (!tool) {
    return undefined;
  }

  return {
    type: "tool_use",
    tool,
    input: payload.input,
  };
}

function parseErrorFromPayload(
  payload: Record<string, unknown>,
): Extract<AgentEvent, { type: "error" }> | undefined {
  if (payload.type !== "error") {
    return undefined;
  }

  return {
    type: "error",
    message: readString(payload.message) ?? "Unknown Gemini CLI error",
    recoverable: payload.recoverable !== false,
  };
}

function parseErrorEvent(
  line: string,
  stream: "stdout" | "stderr",
  payload: Record<string, unknown> | undefined,
): Extract<AgentEvent, { type: "error" }> | undefined {
  if (payload) {
    const payloadError = parseErrorFromPayload(payload);
    if (payloadError) {
      return payloadError;
    }
  }

  if (stream === "stderr" && /error|failed|exception/i.test(line)) {
    return { type: "error", message: line.trim(), recoverable: true };
  }

  return undefined;
}

function estimateTokenCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeUnknownError(error: unknown, executionId: string): OacError {
  if (error instanceof OacError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return executionError("AGENT_TIMEOUT", `Gemini execution timed out for ${executionId}`, {
      context: { executionId, message },
      cause: error,
    });
  }

  if (/out of memory|ENOMEM|heap/i.test(message)) {
    return executionError("AGENT_OOM", `Gemini execution ran out of memory for ${executionId}`, {
      context: { executionId, message },
      cause: error,
    });
  }

  if (/rate.limit|429|too many requests|throttl/i.test(message)) {
    return executionError(
      "AGENT_RATE_LIMITED",
      `Gemini execution rate-limited for ${executionId}`,
      {
        context: { executionId, message },
        cause: error,
      },
    );
  }

  if (/network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new OacError(
      "Gemini execution failed due to network issues",
      "NETWORK_ERROR",
      "recoverable",
      {
        executionId,
        message,
      },
      error,
    );
  }

  return executionError("AGENT_EXECUTION_FAILED", `Gemini execution failed for ${executionId}`, {
    context: { executionId, message },
    cause: error,
  });
}

function computeTotalTokens(state: TokenState): number {
  return Math.max(state.cumulativeTokens, state.inputTokens + state.outputTokens);
}

function normalizeExitCode(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 1;
}

function buildFailureMessage(stdout: string, stderr: string): string {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return trimmedStderr;
  }

  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) {
    return trimmedStdout;
  }

  return "Gemini CLI process exited with a non-zero status.";
}

function parseVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
  if (!match) {
    return undefined;
  }

  return match[1];
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    timeoutTimer.unref();

    child.once("error", (error) => {
      clearTimeout(timeoutTimer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error,
      });
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timeoutTimer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function estimateContextTokens(targetFiles: string[]): Promise<number> {
  let totalBytes = 0;
  for (const filePath of targetFiles) {
    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        totalBytes += fileStat.size;
      }
    } catch {
      // Ignore missing files and treat as zero-context for estimation.
    }
  }

  return Math.ceil(totalBytes / 4);
}

export class GeminiAdapter implements AgentProvider {
  public readonly id: AgentProviderId = "gemini";
  public readonly name = "Gemini CLI";

  private readonly runningExecutions = new Map<string, RunningProcess>();
  private readonly abortedExecutions = new Set<string>();

  public async checkAvailability(): Promise<AgentAvailability> {
    const versionResult = await runCommand("gemini", ["--version"], 5_000);
    if (versionResult.exitCode === 0) {
      return {
        available: true,
        version: parseVersion(versionResult.stdout) ?? parseVersion(versionResult.stderr),
      };
    }

    const whichResult = await runCommand("which", ["gemini"], 3_000);
    if (whichResult.exitCode === 0 && whichResult.stdout.trim().length > 0) {
      return {
        available: true,
        version: parseVersion(versionResult.stdout) ?? parseVersion(versionResult.stderr),
      };
    }

    const error =
      readString(versionResult.stderr) ??
      readString(whichResult.stderr) ??
      (versionResult.error instanceof Error ? versionResult.error.message : undefined) ??
      "Gemini CLI is not available. Install Gemini CLI and ensure `gemini` is on PATH.";

    return {
      available: false,
      error,
    };
  }

  public execute(params: AgentExecuteParams): AgentExecution {
    const startedAt = Date.now();
    const filesChanged = new Set<string>();
    const tokenState: TokenState = {
      inputTokens: 0,
      outputTokens: 0,
      cumulativeTokens: 0,
    };
    const eventQueue = new AsyncEventQueue<AgentEvent>();
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const processEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      ...params.env,
      OAC_TOKEN_BUDGET: `${params.tokenBudget}`,
      OAC_ALLOW_COMMITS: `${params.allowCommits}`,
    };

    const subprocess = spawn("gemini", ["-p", params.prompt, "--yolo", "-o", "text"], {
      cwd: params.workingDirectory,
      env: processEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.runningExecutions.set(params.executionId, subprocess);

    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      subprocess.kill("SIGTERM");
    }, params.timeoutMs);
    timeoutTimer.unref();

    const processStdoutLine = (line: string): void => {
      const payload = parseJsonPayload(line);
      const tokenEvent = parseTokenEvent(line, payload, tokenState);
      if (tokenEvent?.type === "tokens") {
        eventQueue.push(tokenEvent);
      }

      const fileEvent = parseFileEditEvent(line, payload);
      if (fileEvent) {
        filesChanged.add(fileEvent.path);
        eventQueue.push(fileEvent);
      }

      if (!payload) {
        return;
      }

      const toolEvent = parseToolUseFromPayload(payload);
      if (toolEvent) {
        eventQueue.push(toolEvent);
      }

      const errorEvent = parseErrorEvent(line, "stdout", payload);
      if (errorEvent) {
        eventQueue.push(errorEvent);
      }
    };

    const processStderrLine = (line: string): void => {
      const payload = parseJsonPayload(line);
      const errorEvent = parseErrorEvent(line, "stderr", payload);
      if (errorEvent) {
        eventQueue.push(errorEvent);
      }
    };

    const consumeStream = async (
      stream: NodeJS.ReadableStream | null,
      streamName: "stdout" | "stderr",
    ): Promise<void> => {
      if (!stream) {
        return;
      }

      const lineReader = createInterface({
        input: stream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      for await (const line of lineReader) {
        if (streamName === "stdout") {
          stdoutBuffer += `${line}\n`;
        } else {
          stderrBuffer += `${line}\n`;
        }

        eventQueue.push({ type: "output", content: line, stream: streamName });

        if (streamName === "stdout") {
          processStdoutLine(line);
        } else {
          processStderrLine(line);
        }
      }
    };

    const stdoutDone = consumeStream(subprocess.stdout, "stdout");
    const stderrDone = consumeStream(subprocess.stderr, "stderr");

    const settledPromise = new Promise<ProcessExit>((resolve, reject) => {
      subprocess.once("error", (error) => {
        reject(error);
      });

      subprocess.once("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });

    const resultPromise = (async (): Promise<AgentResult> => {
      try {
        const settled = await settledPromise;
        await Promise.all([stdoutDone, stderrDone]);

        if (timedOut) {
          const timeoutError = executionError(
            "AGENT_TIMEOUT",
            `Gemini execution timed out for ${params.executionId}`,
            {
              context: {
                executionId: params.executionId,
                timeoutMs: params.timeoutMs,
              },
            },
          );
          eventQueue.push({
            type: "error",
            message: timeoutError.message,
            recoverable: true,
          });
          throw timeoutError;
        }

        if (this.abortedExecutions.has(params.executionId)) {
          return {
            success: false,
            exitCode: normalizeExitCode(settled.exitCode),
            totalTokensUsed: computeTotalTokens(tokenState),
            filesChanged: [...filesChanged],
            duration: Date.now() - startedAt,
            error: "Gemini execution was cancelled.",
          };
        }

        const exitCode = normalizeExitCode(settled.exitCode);
        const success = exitCode === 0;

        return {
          success,
          exitCode,
          totalTokensUsed: computeTotalTokens(tokenState),
          filesChanged: [...filesChanged],
          duration: Date.now() - startedAt,
          error: success ? undefined : buildFailureMessage(stdoutBuffer, stderrBuffer),
        };
      } catch (error) {
        const normalized = normalizeUnknownError(error, params.executionId);
        eventQueue.push({
          type: "error",
          message: normalized.message,
          recoverable: normalized.severity !== "fatal",
        });
        eventQueue.fail(normalized);
        throw normalized;
      } finally {
        clearTimeout(timeoutTimer);
        this.runningExecutions.delete(params.executionId);
        this.abortedExecutions.delete(params.executionId);
        eventQueue.close();
      }
    })();

    return {
      executionId: params.executionId,
      providerId: this.id,
      events: eventQueue,
      result: resultPromise,
      pid: subprocess.pid ?? undefined,
    };
  }

  public async estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate> {
    const baseTokens = Math.ceil(params.targetFiles.length * 1_800);
    const promptTokens = estimateTokenCount(params.prompt);
    const contextTokens = await estimateContextTokens(params.targetFiles);
    const expectedOutputTokens = Math.max(baseTokens, Math.ceil(promptTokens * 1.2));
    const totalEstimatedTokens = contextTokens + promptTokens + expectedOutputTokens;

    return {
      taskId: params.taskId,
      providerId: this.id,
      contextTokens,
      promptTokens,
      expectedOutputTokens,
      totalEstimatedTokens,
      confidence: 0.55,
      feasible: totalEstimatedTokens < 1_000_000,
    };
  }

  public async abort(executionId: string): Promise<void> {
    const running = this.runningExecutions.get(executionId);
    if (!running) {
      return;
    }

    this.abortedExecutions.add(executionId);

    running.kill("SIGTERM");
    const forceKillTimer = setTimeout(() => {
      running.kill("SIGKILL");
    }, 2_000);
    forceKillTimer.unref();

    try {
      if (running.exitCode === null && running.signalCode === null) {
        await new Promise<void>((resolve) => {
          running.once("close", () => resolve());
          running.once("error", () => resolve());
        });
      }
    } finally {
      clearTimeout(forceKillTimer);
    }
  }
}
