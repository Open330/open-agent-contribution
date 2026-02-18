import { type Tiktoken, get_encoding } from "tiktoken";

const CODEX_INVOCATION_OVERHEAD = 1_000;
const CODEX_MAX_CONTEXT_TOKENS = 200_000;
const PRIMARY_ENCODING = "o200k_base";
const FALLBACK_ENCODING = "cl100k_base";

type SupportedCodexEncoding = typeof PRIMARY_ENCODING | typeof FALLBACK_ENCODING;

let encoder: Tiktoken | undefined;
let selectedEncoding: SupportedCodexEncoding | undefined;

function getEncoder(): Tiktoken {
  if (encoder) {
    return encoder;
  }

  try {
    encoder = get_encoding(PRIMARY_ENCODING);
    selectedEncoding = PRIMARY_ENCODING;
  } catch {
    encoder = get_encoding(FALLBACK_ENCODING);
    selectedEncoding = FALLBACK_ENCODING;
  }

  return encoder;
}

export class CodexTokenCounter {
  readonly invocationOverhead = CODEX_INVOCATION_OVERHEAD;
  readonly maxContextTokens = CODEX_MAX_CONTEXT_TOKENS;

  get encoding(): SupportedCodexEncoding {
    getEncoder();
    return selectedEncoding ?? FALLBACK_ENCODING;
  }

  countTokens(text: string): number {
    return getEncoder().encode(text).length;
  }

  /** Free the cached tiktoken encoder so it can be re-created on next use. */
  reset(): void {
    if (encoder) {
      encoder.free();
      encoder = undefined;
    }
    selectedEncoding = undefined;
  }
}
