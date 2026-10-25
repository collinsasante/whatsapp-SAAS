import { AiMeteredProviderService } from './ai-metered-provider.service';
import { AiCreditsService, InsufficientAiCreditsError } from '../credits/ai-credits.service';
import { AiProvider, AiProviderError, ChatCompletionRequest, ChatCompletionResult } from '../providers/ai-provider.interface';

function buildResult(): ChatCompletionResult {
  return {
    content: 'ok',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5 },
    attemptsUsed: 2,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    latencyMs: 10,
  };
}

describe('AiMeteredProviderService', () => {
  function setup(providerResult = buildResult()) {
    const credits = {
      reserveForProviderCall: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      settleReservationForUsage: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn-1' } }),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
    };
    const provider: AiProvider = {
      key: 'deepseek',
      maxAttempts: 2,
      complete: jest.fn().mockResolvedValue(providerResult),
    };
    return { credits, provider, service: new AiMeteredProviderService(credits as unknown as AiCreditsService) };
  }

  const request: ChatCompletionRequest = {
    modelKey: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 400,
  };

  it('reserves first, settles retries conservatively, and returns the reservation id', async () => {
    const { credits, provider, service } = setup();

    const result = await service.complete(provider, 't1', 'RESPONDER', request);

    expect(result).toEqual({ result: buildResult(), reservationId: 'reservation-1' });
    expect(credits.reserveForProviderCall).toHaveBeenCalledWith('t1', 'deepseek', request.modelKey, 400, 2);
    expect(credits.settleReservationForUsage).toHaveBeenCalledWith('reservation-1', 10, 5, 2, 'RESPONDER AI provider usage');
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it('releases a reservation after a definitive non-retryable provider rejection', async () => {
    const { credits, provider, service } = setup();
    jest.spyOn(provider, 'complete').mockRejectedValue(new AiProviderError('auth', 'invalid key', false));

    await expect(service.complete(provider, 't1', 'RESPONDER', request)).rejects.toThrow('invalid key');
    expect(credits.releaseReservation).toHaveBeenCalledWith('reservation-1');
  });

  it('keeps reservations for uncertain provider outcomes', async () => {
    const { credits, provider, service } = setup();
    jest.spyOn(provider, 'complete').mockRejectedValue(new AiProviderError('network', 'connection lost', true));

    await expect(service.complete(provider, 't1', 'RESPONDER', request)).rejects.toThrow('connection lost');
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it('releases a reservation after a rate limit, which is retryable but not billable', async () => {
    const { credits, provider, service } = setup();
    jest.spyOn(provider, 'complete').mockRejectedValue(new AiProviderError('rate_limited', 'too many requests', true));

    await expect(service.complete(provider, 't1', 'RESPONDER', request)).rejects.toThrow('too many requests');
    expect(credits.releaseReservation).toHaveBeenCalledWith('reservation-1');
  });

  it('does not reserve credits for unmetered background tasks', async () => {
    const { credits, provider, service } = setup();

    await service.complete(provider, 't1', 'SUMMARIZE', request);

    expect(credits.reserveForProviderCall).not.toHaveBeenCalled();
    expect(credits.settleReservationForUsage).not.toHaveBeenCalled();
  });

  it('does not call the provider when reservation fails', async () => {
    const { credits, provider, service } = setup();
    jest.spyOn(credits, 'reserveForProviderCall').mockRejectedValue(new InsufficientAiCreditsError());

    await expect(service.complete(provider, 't1', 'RESPONDER', request)).rejects.toThrow('Insufficient AI credits');
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
