import { Module } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { ReleasePublicController } from './release.controller';

@Module({
  controllers: [ReleasePublicController],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
