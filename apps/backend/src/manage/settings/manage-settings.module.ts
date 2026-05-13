import { Module } from '@nestjs/common';
import { ManageSettingsService } from './manage-settings.service';
import { ManageSettingsController } from './manage-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ManageSettingsController],
  providers: [ManageSettingsService],
})
export class ManageSettingsModule {}
