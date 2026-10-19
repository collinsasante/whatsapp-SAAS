import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

// Webhooks send workspace data to external servers, so changing them is an admin action.
// Listing stays open to signed-in members and never includes secrets or header values.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('manage/webhooks')
export class WebhooksController {
  constructor(private service: WebhooksService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) { return this.service.list(u.tenantId); }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() u: JwtPayload, @Body() body: CreateWebhookDto) {
    return this.service.create(u.tenantId, body, u.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: UpdateWebhookDto) {
    return this.service.update(id, u.tenantId, body, u.sub);
  }

  @Post(':id/rotate-secret')
  @Roles(UserRole.ADMIN)
  rotateSecret(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.rotateSecret(id, u.tenantId, u.sub);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, u.tenantId, u.sub);
  }

  @Post(':id/test')
  @Roles(UserRole.ADMIN)
  test(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.test(id, u.tenantId);
  }
}
