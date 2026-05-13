import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';
import { TemplateStatus } from '@whatsapp-platform/shared-types';

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a message template' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTemplateDto, @Req() req: Request) {
    // Use raw body components to bypass class-transformer converting objects to []
    const rawComponents = (req.body as Record<string, unknown>)?.components;
    const components = Array.isArray(rawComponents) ? rawComponents : dto.components;
    return this.templatesService.create(tenantId, { ...dto, components });
  }

  @Get()
  @ApiOperation({ summary: 'Get all templates' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('status') status?: TemplateStatus,
  ) {
    return this.templatesService.findAll(tenantId, +page, +limit, status);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTemplateDto, @Req() req: Request) {
    const rawComponents = (req.body as Record<string, unknown>)?.components;
    const components = Array.isArray(rawComponents) ? rawComponents : dto.components;
    return this.templatesService.update(tenantId, id, { ...dto, components });
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.remove(tenantId, id);
  }

  @Post(':id/submit')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Submit template to Meta for approval' })
  submit(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.submit(tenantId, id);
  }

  @Delete(':id/with-meta')
  @Roles(UserRole.ADMIN)
  removeWithMeta(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.removeWithMeta(tenantId, id);
  }

  @Post('sync')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Sync templates from WhatsApp Business API' })
  sync(@CurrentTenant() tenantId: string) {
    return this.templatesService.sync(tenantId);
  }
}
