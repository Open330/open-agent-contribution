import { createInterface } from "node:readline";

import { execa } from "execa";
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

type RunningProcess = ReturnType<typeof execa>;

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
    } catch {} // best-effort: agent output may not be valid JSON
  }

  return undefined;
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

function parseTokenPatchFromLine(line: string): TokenPatch {
  const inputMatch = line.match(/(?:input|prompt)\s*tokens?\s*[:=]\s*(\d+)/i);
  const outputMatch = line.match(/(?:output|completion)\s*tokens?\s*[:=]\s*(\d+)/i);
  const totalMatch = line.match(/(?:total|cumulative|used)\s*tokens?\s*[:=]\s*(\d+)/i);

  return {
    inputTokens: inputMatch ? Number.parseInt(inputMatch[1], 10) : undefined,
    outputTokens: outputMatch ? Number.parseInt(outputMatch[1], 10) : undefined,
    cumulativeTokens: totalMatch ? Number.parseInt(totalMatch[1], 10) : undefined,
  };
}

function parseTokenEvent(line: string, state: TokenState): AgentEvent | undefined {
  const payload = parseJsonPayload(line);
  const patch = payload ? parseTokenPatchFromPayload(payload) : parseTokenPatchFromLine(line);
  return patchTokenState(state, patch);
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
  const path = fileActionMatch[2]?.trim();
  if (!action || !path) {
    return undefined;
  }

  return {
    type: "file_edit",
    action,
    path,
  };
}

function parseFileEditEvent(line: string): Extract<AgentEvent, { type: "file_edit" }> | undefined {
  const payload = parseJsonPayload(line);
  return payload ? parseFileEditFromPayload(payload) : parseFileEditFromLine(line);
}

function parseToolUseEvent(line: string): Extract<AgentEvent, { type: "tool_use" }> | undefined {
  const payload = parseJsonPayload(line);
  if (!payload) {
    return undefined;
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

function parseErrorEvent(
  line: string,
  stream: "stdout" | "stderr",
): Extract<AgentEvent, { type: "error" }> | undefined {
  const payload = parseJsonPayload(line);
  if (payload?.type === "error") {
    const message = readString(payload.message) ?? "Unknown Claude CLI error";
    const recoverable = payload.recoverable !== false;
    return { type: "error", message, recoverable };
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
    return executionError("AGENT_TIMEOUT", `Claude execution timed out for ${executionId}`, {
      context: { executionId, message },
      cause: error,
    });
  }

  if (/out of memory|ENOMEM|heap/i.test(message)) {
    return executionError("AGENT_OOM", `Claude execution ran out of memory for ${executionId}`, {
      context: { executionId, message },
      cause: error,
    });
  }

  if (/network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new OacError(
      "Claude execution failed due to network issues",
      "NETWORK_ERROR",
      "recoverable",
      {
        executionId,
        message,
      },
      error,
    );
  }

  return executionError("AGENT_EXECUTION_FAILED", `Claude execution failed for ${executionId}`, {
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

function hasBooleanFlag(value: unknown, key: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value[key] === true;
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

  return "Claude CLI process exited with a non-zero status.";
}

export class ClaudeCodeAdapter implements AgentProvider {
  public readonly id: AgentProviderId = "claude-code";
  public readonly name = "Claude Code";

  private readonly runningExecutions = new Map<string, RunningProcess>();

  public async checkAvailability(): Promise<AgentAvailability> {
    try {
      const result = await execa("claude", ["--version"], { reject: false });
      const version = result.stdout.trim().split("\n")[0];
      if (result.exitCode === 0) {
        return {
          available: true,
          version: version.length > 0 ? version : undefined,
        };
      }

      return {
        available: false,
        error: result.stderr.trim() || `claude --version exited with code ${result.exitCode}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        error: message,
      };
    }
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

    const processEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" &&
            // Strip Claude Code session markers to allow spawning a fresh Claude subprocess
            entry[0] !== "CLAUDECODE" &&
            entry[0] !== "CLAUDE_CODE_SESSION",
        ),
      ),
      ...params.env,
      OAC_TOKEN_BUDGET: `${params.tokenBudget}`,
      OAC_ALLOW_COMMITS: `${params.allowCommits}`,
    };

    const subprocess = execa("claude", ["-p", params.prompt], {
      cwd: params.workingDirectory,
      env: processEnv,
      extendEnv: false,
      reject: false,
      timeout: params.timeoutMs,
    });

    this.runningExecutions.set(params.executionId, subprocess);

    const consumeStream = async (
      stream: NodeJS.ReadableStream | undefined,
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
        eventQueue.push({
          type: "output",
          content: line,
          stream: streamName,
        });

        const tokenEvent = parseTokenEvent(line, tokenState);
        if (tokenEvent?.type === "tokens") {
          eventQueue.push(tokenEvent);
        }

        const fileEvent = parseFileEditEvent(line);
        if (fileEvent) {
          filesChanged.add(fileEvent.path);
          eventQueue.push(fileEvent);
        }

        const toolEvent = parseToolUseEvent(line);
        if (toolEvent) {
          eventQueue.push(toolEvent);
        }

        const errorEvent = parseErrorEvent(line, streamName);
        if (errorEvent) {
          eventQueue.push(errorEvent);
        }
      }
    };

    const stdoutDone = consumeStream(subprocess.stdout ?? undefined, "stdout");
    const stderrDone = consumeStream(subprocess.stderr ?? undefined, "stderr");

    const resultPromise = (async (): Promise<AgentResult> => {
      try {
        const settled = await subprocess;
        await Promise.all([stdoutDone, stderrDone]);

        const timedOut = hasBooleanFlag(settled, "timedOut");
        if (timedOut) {
          const timeoutError = executionError(
            "AGENT_TIMEOUT",
            `Claude execution timed out for ${params.executionId}`,
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

        const canceled = hasBooleanFlag(settled, "isCanceled");
        if (canceled) {
          return {
            success: false,
            exitCode: normalizeExitCode(settled.exitCode),
            totalTokensUsed: computeTotalTokens(tokenState),
            filesChanged: [...filesChanged],
            duration: Date.now() - startedAt,
            error: "Claude execution was cancelled.",
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
          error: success ? undefined : buildFailureMessage(settled.stdout, settled.stderr),
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
        this.runningExecutions.delete(params.executionId);
        eventQueue.close();
      }
    })();

    return {
      executionId: params.executionId,
      providerId: this.id,
      events: eventQueue,
      result: resultPromise,
      pid: subprocess.pid,
    };
  }

  public async estimateTokens(params: TokenEstimateParams): Promise<TokenEstimate> {
    const contextTokens =
      params.contextTokens ?? params.targetFiles.length * 80 + params.targetFiles.join("\n").length;
    const promptTokens = estimateTokenCount(params.prompt);
    const expectedOutputTokens =
      params.expectedOutputTokens ?? Math.max(128, Math.ceil(promptTokens * 0.6));
    const totalEstimatedTokens = contextTokens + promptTokens + expectedOutputTokens;

    return {
      taskId: params.taskId,
      providerId: this.id,
      contextTokens,
      promptTokens,
      expectedOutputTokens,
      totalEstimatedTokens,
      confidence: 0.6,
      feasible: true,
    };
  }

  public async abort(executionId: string): Promise<void> {
    const running = this.runningExecutions.get(executionId);
    if (!running) {
      return;
    }

    running.kill("SIGTERM");
    const forceKillTimer = setTimeout(() => {
      running.kill("SIGKILL");
    }, 5_000);
    forceKillTimer.unref();

    try {
      await running;
    } catch {
      // Swallow process errors caused by shutdown.
    } finally {
      clearTimeout(forceKillTimer);
    }
  }
}
