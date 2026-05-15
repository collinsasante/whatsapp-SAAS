import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';

// Strategy & Guard
import { PlatformAdminJwtStrategy } from './strategies/platform-admin-jwt.strategy';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

// Services
import { PlatformAdminAuthService } from './services/platform-admin-auth.service';
import { PlatformAdminService } from './services/platform-admin.service';
import { ImpersonationService } from './services/impersonation.service';
import { PlatformAuditService } from './services/platform-audit.service';

// Controllers
import { PlatformAdminAuthController } from './controllers/platform-admin-auth.controller';
import { PlatformDashboardController } from './controllers/platform-dashboard.controller';
import { PlatformWorkspacesController } from './controllers/platform-workspaces.controller';
import { PlatformUsersController } from './controllers/platform-users.controller';
import { PlatformChannelsController } from './controllers/platform-channels.controller';
import { PlatformAnalyticsController } from './controllers/platform-analytics.controller';
import { PlatformAuditController } from './controllers/platform-audit.controller';
import { PlatformSettingsController } from './controllers/platform-settings.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'platform-admin-jwt' }),
    JwtModule.register({}),
  ],
  controllers: [
    PlatformAdminAuthController,
    PlatformDashboardController,
    PlatformWorkspacesController,
    PlatformUsersController,
    PlatformChannelsController,
    PlatformAnalyticsController,
    PlatformAuditController,
    PlatformSettingsController,
  ],
  providers: [
    PlatformAdminJwtStrategy,
    PlatformAdminGuard,
    PlatformAdminAuthService,
    PlatformAdminService,
    ImpersonationService,
    PlatformAuditService,
  ],
  exports: [PlatformAuditService],
})
export class PlatformAdminModule {}
