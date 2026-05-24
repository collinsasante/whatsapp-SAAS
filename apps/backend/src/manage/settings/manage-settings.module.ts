import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ManageSettingsService } from './manage-settings.service';
import { ManageSettingsController } from './manage-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EmailService } from '../../common/email.service';
import { QueueName } from '@whatsapp-platform/shared-types';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BullModule.registerQueue({ name: QueueName.AI_TRIAL }),
  ],
  controllers: [ManageSettingsController],
  providers: [ManageSettingsService, EmailService],
  exports: [ManageSettingsService],
})
export class ManageSettingsModule {}
