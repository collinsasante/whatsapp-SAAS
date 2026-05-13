import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@UseGuards(JwtAuthGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.teamsService.findAll(tenantId);
  }

  @Get('users')
  getUsers(@CurrentTenant() tenantId: string) {
    return this.teamsService.getAvailableUsers(tenantId);
  }

  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body() body: { name: string; description?: string },
  ) {
    return this.teamsService.create(tenantId, body.name, body.description);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.teamsService.update(tenantId, id, body.name, body.description);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.teamsService.remove(tenantId, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.teamsService.addMember(tenantId, id, body.userId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.teamsService.removeMember(tenantId, id, userId);
  }
}
