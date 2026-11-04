import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramWebhookController } from './telegram.webhook.controller';
import { MessagesModule } from '../messages/messages.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [forwardRef(() => MessagesModule), MediaModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
