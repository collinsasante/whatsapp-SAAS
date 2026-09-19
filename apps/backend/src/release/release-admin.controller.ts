import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import { RequirePlatformRole } from '../platform-admin/decorators/require-platform-role.decorator';
import { ReleaseService } from './release.service';
import { CreateReleaseDto, LogDeploymentDto, UpdateReleaseDto } from './release.dto';

/**
 * Write side of app version tracking (create/update a release, log a
 * deployment) -- SUPER_ADMIN only, since publishing a version bump or
 * marking one isLatest is what every client's `GET /public/version` reads.
 * The read side (ReleasePublicController) stays unauthenticated.
 */
@ApiTags('Platform Admin - Releases')
@Controller('platform-admin/releases')
export class ReleaseAdminController {
  constructor(private readonly svc: ReleaseService) {}

  @Get()
  @UseGuards(PlatformAdminGuard)
  listVersions() {
    return this.svc.listVersions();
  }

  @Post()
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  createVersion(@Body() dto: CreateReleaseDto) {
    return this.svc.createVersion(dto);
  }

  @Patch(':id')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN')
  updateVersion(@Param('id') id: string, @Body() dto: UpdateReleaseDto) {
    return this.svc.updateVersion(id, dto);
  }

  @Get('deployments')
  @UseGuards(PlatformAdminGuard)
  listDeployments(@Query('environment') environment?: string) {
    return this.svc.listDeployments(environment);
  }

  @Post('deployments')
  @UseGuards(PlatformAdminGuard)
  @RequirePlatformRole('SUPER_ADMIN', 'SUPPORT')
  logDeployment(@Body() dto: LogDeploymentDto) {
    return this.svc.logDeployment(dto);
  }
}
