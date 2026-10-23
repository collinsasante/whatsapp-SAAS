import { Injectable } from '@nestjs/common';
import { AiProvider, ChatCompletionRequest, ChatCompletionResult } from './ai-provider.interface';

/**
 * Deterministic provider for tests and CI -- never makes a network call. Configure
 * `nextResult`/`nextError` before invoking a caller under test; every call is
 * recorded in `calls` so tests can assert exactly what was sent (e.g. that a
 * blocked/short-circuited pipeline stage never reached the provider at all).
 */
@Injectable()
export class MockProvider implements AiProvider {
  readonly key = 'mock';
  readonly calls: ChatCompletionRequest[] = [];
  nextResult: ChatCompletionResult | null = null;
  nextError: Error | null = null;

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(req);
    if (this.nextError) {
      const err = this.nextError;
      throw err;
    }
    if (this.nextResult) return this.nextResult;
    return {
      content: JSON.stringify({ response: 'Mock response', confidence: 90 }),
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      provider: this.key,
      model: req.modelKey,
      latencyMs: 1,
    };
  }

  reset(): void {
    this.calls.length = 0;
    this.nextResult = null;
    this.nextError = null;
  }
}
