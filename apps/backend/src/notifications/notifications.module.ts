import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PushTokenService } from './push-token.service';
import { ExpoPushService } from './expo-push.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushTokenService, ExpoPushService],
  exports: [NotificationsService, PushTokenService],
})
export class NotificationsModule {}
