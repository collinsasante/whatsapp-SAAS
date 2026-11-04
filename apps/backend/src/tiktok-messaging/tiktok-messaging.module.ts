import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TikTokMessagingController, TikTokMessagingWebhookController } from './tiktok-messaging.controller';
import { TikTokMessagingService } from './tiktok-messaging.service';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { MediaModule } from '../media/media.module';
import { ContactsModule } from '../contacts/contacts.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [ConfigModule, AuditModule, FeatureFlagsModule, MediaModule, ContactsModule, forwardRef(() => MessagesModule)],
  controllers: [TikTokMessagingController, TikTokMessagingWebhookController],
  providers: [TikTokMessagingService],
  exports: [TikTokMessagingService],
})
export class TikTokMessagingModule {}
