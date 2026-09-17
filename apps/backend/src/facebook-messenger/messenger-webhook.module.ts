import { Module, forwardRef } from '@nestjs/common';
import { MessengerWebhookController } from './messenger.webhook.controller';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => MessagesModule)],
  controllers: [MessengerWebhookController],
})
export class MessengerWebhookModule {}
