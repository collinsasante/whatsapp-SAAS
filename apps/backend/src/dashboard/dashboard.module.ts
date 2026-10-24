import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DashboardCommandController } from './dashboard-command.controller';
import { DashboardCommandService } from './dashboard-command.service';

@Module({
  imports: [PrismaModule, WhatsappModule, AnalyticsModule],
  controllers: [DashboardController, DashboardCommandController],
  providers: [DashboardService, DashboardCommandService],
  exports: [DashboardService],
})
export class DashboardModule {}
