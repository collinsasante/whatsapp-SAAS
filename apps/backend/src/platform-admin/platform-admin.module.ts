import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailService } from '../common/email.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformHealthService } from './platform-health.service';

@Module({
  imports: [
    PrismaModule,
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
  controllers: [PlatformAdminController],
  providers: [PlatformAdminAuthService, PlatformAdminService, PlatformAdminGuard, PlatformAuditService, PlatformHealthService, EmailService],
})
export class PlatformAdminModule {}
