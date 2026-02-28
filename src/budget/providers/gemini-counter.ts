import { type Tiktoken, get_encoding } from "tiktoken";

const GEMINI_INVOCATION_OVERHEAD = 1_200;
const GEMINI_MAX_CONTEXT_TOKENS = 1_000_000;
const PRIMARY_ENCODING = "o200k_base";
const FALLBACK_ENCODING = "cl100k_base";

type SupportedGeminiEncoding = typeof PRIMARY_ENCODING | typeof FALLBACK_ENCODING;

let encoder: Tiktoken | undefined;
let selectedEncoding: SupportedGeminiEncoding | undefined;

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

export class GeminiTokenCounter {
  readonly invocationOverhead = GEMINI_INVOCATION_OVERHEAD;
  readonly maxContextTokens = GEMINI_MAX_CONTEXT_TOKENS;

  get encoding(): SupportedGeminiEncoding {
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
