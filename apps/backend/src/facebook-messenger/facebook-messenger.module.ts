import { Module, forwardRef } from '@nestjs/common';
import { MessengerWebhookController } from './messenger.webhook.controller';
import { FacebookMessengerService } from './facebook-messenger.service';
import { MessengerHistorySyncService } from './messenger-history-sync.service';
import { MessengerHistorySyncController } from './messenger-history-sync.controller';
import { MessagesModule } from '../messages/messages.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [forwardRef(() => MessagesModule), ContactsModule],
  controllers: [MessengerWebhookController, MessengerHistorySyncController],
  providers: [FacebookMessengerService, MessengerHistorySyncService],
  exports: [FacebookMessengerService, MessengerHistorySyncService],
})
export class FacebookMessengerModule {}
