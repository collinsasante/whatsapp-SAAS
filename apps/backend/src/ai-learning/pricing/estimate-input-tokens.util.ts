/**
 * An UPPER ESTIMATE of the input tokens of a chat request, used only to size a reservation BEFORE the provider reports real usage.
 *
 * Basis: a token encodes at least one byte of the UTF-8 text, so the UTF-8 byte length of the message contents cannot be smaller than
 * the token count of those contents for any byte-level tokenizer; a fixed allowance per message and per request covers the chat
 * template. This is a conservative engineering argument, NOT a tokenizer guarantee from DeepSeek (which publishes only approximate
 * character-to-token ratios and says the usage in the API response is authoritative). It over-reserves, typically several times,
 * which only costs budget headroom while a run is in flight or unreconciled. Settlement always uses the provider-reported usage, and
 * the ledger raises a tripwire (pauses the workspace) if the provider ever reports more input tokens than this estimate.
 */
export const PER_MESSAGE_TOKEN_ALLOWANCE = 8;
export const PER_REQUEST_TOKEN_ALLOWANCE = 16;

export function estimateInputTokensUpperBound(messages: ReadonlyArray<{ content: string }>): number {
  let tokens = PER_REQUEST_TOKEN_ALLOWANCE;
  for (const m of messages) tokens += Buffer.byteLength(m.content, 'utf8') + PER_MESSAGE_TOKEN_ALLOWANCE;
  return tokens;
}
