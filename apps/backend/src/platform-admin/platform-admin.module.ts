import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminAuthService, PlatformAdminService, PlatformAdminGuard],
})
export class PlatformAdminModule {}
