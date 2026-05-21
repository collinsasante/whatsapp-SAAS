import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ReleaseService, CreateVersionDto, LogDeploymentDto } from './release.service';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';

// Public endpoint — no auth needed (called by frontend on load)
@Controller('public')
export class ReleasePublicController {
  constructor(private readonly svc: ReleaseService) {}

  @Get('version')
  getCurrentVersion() {
    return this.svc.getCurrentVersion();
  }
}

// Admin endpoints
@Controller('releases')
@UseGuards(PlatformAdminGuard)
export class ReleaseController {
  constructor(private readonly svc: ReleaseService) {}

  @Get('versions')
  listVersions() {
    return this.svc.listVersions();
  }

  @Post('versions')
  createVersion(@Body() dto: CreateVersionDto) {
    return this.svc.createVersion(dto);
  }

  @Patch('versions/:id')
  updateVersion(@Param('id') id: string, @Body() dto: Partial<CreateVersionDto>) {
    return this.svc.updateVersion(id, dto);
  }

  @Get('deployments')
  listDeployments(@Query('environment') env?: string) {
    return this.svc.listDeployments(env);
  }

  @Post('deployments')
  @HttpCode(HttpStatus.CREATED)
  logDeployment(@Body() dto: LogDeploymentDto) {
    return this.svc.logDeployment(dto);
  }
}
