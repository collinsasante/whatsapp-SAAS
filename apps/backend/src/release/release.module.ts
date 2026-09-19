import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ReleaseService } from './release.service';
import { ReleasePublicController } from './release.controller';
import { ReleaseAdminController } from './release-admin.controller';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';

@Module({
  // JwtModule.register({}) + a local PlatformAdminGuard provider -- mirrors
  // PlatformAdminModule's own setup exactly, since PlatformAdminGuard isn't
  // exported from there for other modules to reuse.
  imports: [JwtModule.register({})],
  controllers: [ReleasePublicController, ReleaseAdminController],
  providers: [ReleaseService, PlatformAdminGuard],
  exports: [ReleaseService],
})
export class ReleaseModule {}
