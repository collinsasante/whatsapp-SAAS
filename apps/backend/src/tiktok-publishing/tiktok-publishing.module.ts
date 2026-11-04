import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TikTokPublishingController } from './tiktok-publishing.controller';
import { TikTokPublishingService } from './tiktok-publishing.service';
import { AuditModule } from '../audit/audit.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [ConfigModule, AuditModule, FeatureFlagsModule, MediaModule],
  controllers: [TikTokPublishingController],
  providers: [TikTokPublishingService],
  exports: [TikTokPublishingService],
})
export class TikTokPublishingModule {}
