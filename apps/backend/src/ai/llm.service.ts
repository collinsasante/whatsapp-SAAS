import { Injectable, Logger } from '@nestjs/common';

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmCallResult {
  raw: string | null;
  /** True if every retry/repair attempt failed -- caller must degrade gracefully. */
  failed: boolean;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

/**
 * Generation-model abstraction (Phase 5.1). DeepSeek is the default/only
 * implementation today; swapping providers or models is a config change
 * (LLM_PROVIDER / LLM_MODEL env vars), not a code change in callers.
 *
 * Handles retry-with-backoff on transient failures (timeout, 5xx, network)
 * and one repair-reprompt attempt when the model returns non-JSON despite
 * `response_format: json_object` (small models occasionally wrap the JSON in
 * prose anyway). Callers get a single `failed` boolean and must degrade --
 * this class never throws for a model-side failure.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly model = process.env.LLM_MODEL ?? 'deepseek-chat';
  private readonly maxRetries = 2;
  private readonly baseDelayMs = 500;

  async call(messages: LlmMessage[], opts: { maxTokens: number; jsonMode: boolean }): Promise<LlmCallResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return { raw: null, failed: true, latencyMs: 0, promptTokens: null, completionTokens: null };

    const start = Date.now();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: this.model,
            max_tokens: opts.maxTokens,
            messages,
            ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          },
          { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20_000 },
        );
        const raw = (res.data?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? null;
        return {
          raw,
          failed: false,
          latencyMs: Date.now() - start,
          promptTokens: res.data?.usage?.prompt_tokens ?? null,
          completionTokens: res.data?.usage?.completion_tokens ?? null,
        };
      } catch (err) {
        lastErr = err;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (err as any)?.response?.status;
        const transient = !status || status >= 500 || status === 429;
        if (!transient || attempt === this.maxRetries) break;
        await new Promise((r) => setTimeout(r, this.baseDelayMs * Math.pow(2, attempt)));
      }
    }

    this.logger.error(`LLM call failed after ${this.maxRetries + 1} attempts`, lastErr as Error);
    return { raw: null, failed: true, latencyMs: Date.now() - start, promptTokens: null, completionTokens: null };
  }

  /**
   * One repair-reprompt attempt when the model's response isn't valid JSON --
   * asks it to reformat its own prior answer, rather than silently discarding
   * a possibly-good answer over a formatting slip.
   */
  async repairJson(originalMessages: LlmMessage[], badRaw: string, maxTokens: number): Promise<LlmCallResult> {
    const repairMessages: LlmMessage[] = [
      ...originalMessages,
      { role: 'assistant', content: badRaw },
      { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the valid JSON object, nothing else.' },
    ];
    return this.call(repairMessages, { maxTokens, jsonMode: true });
  }
}
