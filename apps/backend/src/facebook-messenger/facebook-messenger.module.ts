import { Module, forwardRef } from '@nestjs/common';
import { MessengerWebhookController } from './messenger.webhook.controller';
import { FacebookMessengerService } from './facebook-messenger.service';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => MessagesModule)],
  controllers: [MessengerWebhookController],
  providers: [FacebookMessengerService],
  exports: [FacebookMessengerService],
})
export class FacebookMessengerModule {}
