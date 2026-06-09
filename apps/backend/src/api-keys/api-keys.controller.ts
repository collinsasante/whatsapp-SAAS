import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { ApiKeysService } from './api-keys.service';

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private service: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: { name: string; expiresAt?: string }) {
    return this.service.create(
      user.tenantId,
      user.sub,
      body.name,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
    );
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.delete(id, user.tenantId);
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.revoke(id, user.tenantId);
  }

  @Get('logs')
  getLogs(@CurrentUser() user: JwtPayload) {
    return this.service.getLogs(user.tenantId);
  }
}
