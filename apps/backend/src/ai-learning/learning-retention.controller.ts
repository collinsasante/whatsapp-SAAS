import { Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { secretsMatch } from '../common/security/safe-equal.util';
import { AiLearningRetentionService } from './learning-retention.service';

/**
 * Internal trigger for the retention sweep, for a scheduler to call. Nothing schedules it yet. Fails closed like the other internal
 * routes: no configured INTERNAL_SECRET, or a wrong one, means refused. Even with the right secret it does nothing unless
 * AI_LEARNING_RETENTION_ENABLED=true (privacy approval).
 */
@Controller('internal/ai-learning/retention')
export class AiLearningRetentionController {
  constructor(
    private readonly retention: AiLearningRetentionService,
    private readonly config: ConfigService,
  ) {}

  @Post('run')
  @HttpCode(200)
  async run(@Headers('x-internal-secret') secret: string | undefined) {
    if (!secretsMatch(secret, this.config.get<string>('INTERNAL_SECRET', ''))) throw new UnauthorizedException();
    return this.retention.run();
  }
}
