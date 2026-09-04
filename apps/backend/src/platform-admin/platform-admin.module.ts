import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from '../common/email.service';
import { AiCoreModule } from '../ai-core/ai-core.module';
import { CommerceModule } from '../commerce/commerce.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { PromptsController } from '../ai-core/prompts/prompts.controller';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminAnalyticsService } from './platform-admin-analytics.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformHealthService } from './platform-health.service';

@Module({
  imports: [
    PrismaModule,
    AiCoreModule,
    CommerceModule,
    FeatureFlagsModule,
    JwtModule.register({}),
    BullModule.registerQueue(
      { name: QueueName.CAMPAIGN_SEND },
      { name: QueueName.MESSAGE_RETRY },
      { name: QueueName.AUTOMATION_TRIGGER },
      { name: QueueName.SCHEDULED_CAMPAIGN },
      { name: QueueName.SNOOZE },
      { name: QueueName.AI_TRIAL },
      { name: QueueName.SLA_MONITOR },
      { name: QueueName.ANALYTICS_ROLLUP },
      { name: QueueName.WHATSAPP_QUALITY_SYNC },
      { name: 'platform-rollup' },
      { name: 'inactivity-trigger' },
    ),
  ],
  controllers: [PlatformAdminController, PromptsController],
  providers: [PlatformAdminAuthService, PlatformAdminService, PlatformAdminAnalyticsService, PlatformAdminGuard, PlatformAuditService, PlatformHealthService, EmailService],
})
export class PlatformAdminModule {}
