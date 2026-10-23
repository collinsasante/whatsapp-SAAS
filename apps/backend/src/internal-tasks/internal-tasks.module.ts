import { Module } from '@nestjs/common';
import { InternalTasksService } from './internal-tasks.service';
import { InternalTasksController } from './internal-tasks.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [InternalTasksController],
  providers: [InternalTasksService],
  exports: [InternalTasksService],
})
export class InternalTasksModule {}
