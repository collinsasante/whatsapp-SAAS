import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantDto, UpdateTenantSettingsDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Tenant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @ApiOperation({ summary: 'Get current tenant details' })
  findOne(@CurrentTenant() tenantId: string) {
    return this.tenantService.findById(tenantId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get tenant statistics' })
  getStats(@CurrentTenant() tenantId: string) {
    return this.tenantService.getStats(tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update tenant details' })
  update(@CurrentTenant() tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.update(tenantId, dto);
  }

  @Patch('settings')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update tenant settings' })
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdateTenantSettingsDto) {
    return this.tenantService.updateSettings(tenantId, dto);
  }
}
