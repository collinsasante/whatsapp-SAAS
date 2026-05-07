import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a broadcast campaign' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(tenantId, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all campaigns' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.campaignsService.findAll(tenantId, +page, +limit);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.campaignsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(tenantId, id, dto);
  }

  @Post(':id/launch')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Launch a campaign' })
  launch(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.campaignsService.launch(tenantId, id);
  }

  @Post(':id/pause')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Pause a running campaign' })
  pause(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.campaignsService.pause(tenantId, id);
  }
}
