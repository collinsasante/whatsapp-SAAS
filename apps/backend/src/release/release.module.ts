import { Module } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { ReleaseController, ReleasePublicController } from './release.controller';

@Module({
  controllers: [ReleasePublicController, ReleaseController],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
