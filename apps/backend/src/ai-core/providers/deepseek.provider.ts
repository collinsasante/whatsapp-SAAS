import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { DEEPSEEK_API_URL } from '../../common/deepseek';
import { AiProvider, AiProviderError, ChatCompletionRequest, ChatCompletionResult, ChatToolCall } from './ai-provider.interface';

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_BASE_DELAY_MS = 500;

interface DeepSeekResponseBody {
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function mapFinishReason(raw: string | undefined): ChatCompletionResult['finishReason'] {
  switch (raw) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    default: return 'other';
  }
}

function classifyError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  const axiosErr = err as AxiosError;
  if (axiosErr?.code === 'ECONNABORTED' || axiosErr?.message?.includes('timeout')) {
    return new AiProviderError('timeout', 'DeepSeek request timed out', true, err);
  }
  const status = axiosErr?.response?.status;
  if (status === 429) return new AiProviderError('rate_limited', 'DeepSeek rate limit exceeded', true, err);
  if (status === 401 || status === 403) return new AiProviderError('auth', 'DeepSeek authentication failed', false, err);
  if (status !== undefined && status >= 400 && status < 500) {
    return new AiProviderError('invalid_request', `DeepSeek rejected the request (${status})`, false, err);
  }
  if (status !== undefined && status >= 500) {
    return new AiProviderError('server_error', `DeepSeek server error (${status})`, true, err);
  }
  return new AiProviderError('network', axiosErr?.message ?? 'DeepSeek request failed', true, err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class DeepSeekProvider implements AiProvider {
  readonly key = 'deepseek';
  private readonly logger = new Logger(DeepSeekProvider.name);

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const apiKey = req.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new AiProviderError('auth', 'DEEPSEEK_API_KEY is not configured', false);
    }

    let lastError: AiProviderError | undefined;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const startedAt = Date.now();
      try {
        const res = await axios.post<DeepSeekResponseBody>(
          DEEPSEEK_API_URL,
          {
            model: req.modelKey,
            max_tokens: req.maxTokens ?? 400,
            ...(req.temperature !== undefined && { temperature: req.temperature }),
            messages: req.messages.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.toolCallId && { tool_call_id: m.toolCallId }),
              ...(m.toolCalls?.length && {
                tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
              }),
            })),
            ...(req.jsonMode && { response_format: { type: 'json_object' } }),
            ...(req.tools?.length && {
              tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
              tool_choice: 'auto',
            }),
          },
          {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          },
        );

        const choice = res.data.choices?.[0];
        const toolCalls: ChatToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        return {
          content: (choice?.message?.content ?? '').trim(),
          toolCalls,
          finishReason: mapFinishReason(choice?.finish_reason),
          usage: {
            inputTokens: res.data.usage?.prompt_tokens ?? 0,
            outputTokens: res.data.usage?.completion_tokens ?? 0,
          },
          provider: this.key,
          model: res.data.model ?? req.modelKey,
          latencyMs: Date.now() - startedAt,
        };
      } catch (err) {
        lastError = classifyError(err);
        if (!lastError.retryable || attempt === 1) {
          this.logger.warn(`DeepSeek call failed (${lastError.code}, retryable=${lastError.retryable}, attempt=${attempt + 1}): ${lastError.message}`);
          throw lastError;
        }
        this.logger.warn(`DeepSeek call failed (${lastError.code}), retrying once: ${lastError.message}`);
        await sleep(RETRY_BASE_DELAY_MS + Math.random() * RETRY_BASE_DELAY_MS);
      }
    }
    // Unreachable, but satisfies the compiler -- the loop always returns or throws.
    throw lastError ?? new AiProviderError('network', 'DeepSeek call failed for an unknown reason', false);
  }
}
