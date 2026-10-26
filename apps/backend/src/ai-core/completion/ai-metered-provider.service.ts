import { Injectable, Logger } from '@nestjs/common';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { AiCreditsService, InsufficientAiCreditsError } from '../credits/ai-credits.service';
import { AiProvider, AiProviderError, ChatCompletionRequest, ChatCompletionResult } from '../providers/ai-provider.interface';

const METERED_TASK_TYPES: AiTaskType[] = ['RESPONDER', 'LEAD_SCORE'];

@Injectable()
export class AiMeteredProviderService {
  private readonly logger = new Logger(AiMeteredProviderService.name);

  constructor(private credits: AiCreditsService) {}

  async complete(
    provider: AiProvider,
    tenantId: string,
    taskType: AiTaskType,
    request: ChatCompletionRequest,
  ): Promise<{ result: ChatCompletionResult; reservationId?: string }> {
    if (!METERED_TASK_TYPES.includes(taskType)) return { result: await provider.complete(request) };

    const maxAttempts = provider.maxAttempts ?? 1;
    const reservation = await this.credits.reserveForProviderCall(tenantId, provider.key, request.modelKey, request.maxTokens, maxAttempts);
    try {
      const result = await provider.complete(request);
      try {
        const settlement = await this.credits.settleReservationForUsage(
          reservation.id,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.attemptsUsed ?? 1,
          `${taskType} AI provider usage`,
        );
        if (!settlement.settled) throw new Error(`Reservation ${reservation.id} was not settled`);
      } catch (err) {
        this.logger.error(
          `Failed to settle reservation ${reservation.id}; it remains held and will be conservatively expired`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      return { result, reservationId: reservation.id };
    } catch (err) {
      if (err instanceof AiProviderError && !err.uncertainOutcome) {
        await this.credits.releaseReservation(reservation.id);
      } else if (!(err instanceof InsufficientAiCreditsError)) {
        this.logger.warn(`Keeping reservation ${reservation.id} for an uncertain provider outcome`);
      }
      throw err;
    }
  }
}
