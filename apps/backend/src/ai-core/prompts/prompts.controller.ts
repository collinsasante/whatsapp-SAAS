import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { PlatformAdminGuard, AdminRequest } from '../../platform-admin/platform-admin.guard';
import { PromptsService } from './prompts.service';

class CreatePromptVersionDto {
  @IsString()
  version!: string;

  @IsString()
  body!: string;

  @IsArray()
  @IsString({ each: true })
  variables!: string[];

  @IsOptional()
  @IsString()
  changeNote?: string;
}

/**
 * Prompt templates are global, not per-tenant -- tenants customize behavior via
 * AiAgent.systemInstructions, not template forks (that's Phase 2). Platform-admin
 * scoped since activating a version changes behavior for every tenant at once.
 */
@ApiTags('Platform Admin — AI Prompts')
@Controller('platform-admin/ai/prompts')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  @UseGuards(PlatformAdminGuard)
  listTemplates() {
    return this.prompts.listTemplates();
  }

  @Get(':templateId/versions')
  @UseGuards(PlatformAdminGuard)
  listVersions(@Param('templateId') templateId: string) {
    return this.prompts.listVersions(templateId);
  }

  @Post(':templateId/versions')
  @UseGuards(PlatformAdminGuard)
  createVersion(@Param('templateId') templateId: string, @Body() dto: CreatePromptVersionDto, @Req() req: AdminRequest) {
    return this.prompts.createVersion(templateId, { ...dto, createdById: req.adminId });
  }

  @Post(':templateId/versions/:versionId/activate')
  @UseGuards(PlatformAdminGuard)
  activate(@Param('templateId') templateId: string, @Param('versionId') versionId: string) {
    return this.prompts.activateVersion(templateId, versionId);
  }
}
