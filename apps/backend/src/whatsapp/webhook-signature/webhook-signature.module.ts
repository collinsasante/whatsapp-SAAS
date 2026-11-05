import { Module } from '@nestjs/common';
import { WhatsappWebhookSignatureService } from './whatsapp-webhook-signature.service';
import { WebhookSecurityAdminService } from './webhook-security-admin.service';
import { MetaSubscribedAppsClient } from './meta-subscribed-apps.client';

@Module({
  providers: [WhatsappWebhookSignatureService, WebhookSecurityAdminService, MetaSubscribedAppsClient],
  exports: [WhatsappWebhookSignatureService, WebhookSecurityAdminService],
})
export class WebhookSignatureModule {}
