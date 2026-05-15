import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';
import { MessagesModule } from '../messages/messages.module';
import { CallsModule } from '../calls/calls.module';

@Module({
  imports: [forwardRef(() => MessagesModule), forwardRef(() => CallsModule)],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
