export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Only meaningful on a 'tool' role message -- which tool call this is the result of. */
  toolCallId?: string;
  /** Only meaningful on an 'assistant' role message that requested tool calls -- must be
   * echoed back on that assistant turn for the provider to correctly associate the
   * following 'tool' role messages with it on the next round-trip. */
  toolCalls?: ChatToolCall[];
}

export interface ChatToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatCompletionRequest {
  modelKey: string; // catalog key, e.g. the DEEPSEEK_MODEL constant
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /** Accepted by the interface and the DeepSeek adapter; the Phase 1 pipeline never passes this. */
  tools?: ChatToolDef[];
  /** Defaults to 20_000ms -- parity with the legacy responder's axios timeout. */
  timeoutMs?: number;
  /** Override for a future per-tenant key; defaults to the provider's own env-sourced key. */
  apiKey?: string;
  /**
   * Hard TOTAL deadline for the whole call, across every internal attempt and the pause between them. `timeoutMs` alone is not a
   * total: it is a per-attempt limit that a provider answering slowly (headers early, body late, or keep-alive bytes) can outlive.
   * When it passes, the in-flight request is cancelled and the call fails with code 'timeout'. Unset keeps the previous behaviour.
   */
  deadlineMs?: number;
  /** Upper bound on internal attempts for this call (never raises the provider's own limit). 1 = no internal retry. */
  maxAttempts?: number;
  /** Cancels the call when aborted by the caller; surfaces as an AiProviderError with code 'timeout'. */
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other';
  usage: { inputTokens: number; outputTokens: number };
  attemptsUsed?: number;
  provider: string;
  model: string;
  latencyMs: number;
}

export type AiErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'auth'
  | 'invalid_request'
  | 'server_error'
  | 'network'
  | 'parse_error';

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
    readonly uncertainOutcome = retryable && code !== 'rate_limited',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly key: string; // 'deepseek'
  readonly maxAttempts?: number;
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
