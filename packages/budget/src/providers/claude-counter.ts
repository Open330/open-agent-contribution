import { get_encoding, type Tiktoken } from 'tiktoken';

const CLAUDE_ENCODING = 'cl100k_base';
const CLAUDE_INVOCATION_OVERHEAD = 1_500;
const CLAUDE_MAX_CONTEXT_TOKENS = 200_000;

let encoder: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  encoder ??= get_encoding(CLAUDE_ENCODING);
  return encoder;
}

export class ClaudeTokenCounter {
  readonly invocationOverhead = CLAUDE_INVOCATION_OVERHEAD;
  readonly maxContextTokens = CLAUDE_MAX_CONTEXT_TOKENS;
  readonly encoding = CLAUDE_ENCODING;

  countTokens(text: string): number {
    return getEncoder().encode(text).length;
  }
}
