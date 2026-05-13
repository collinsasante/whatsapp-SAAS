import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { WebhooksService, CreateWebhookDto } from './webhooks.service';

@UseGuards(JwtAuthGuard)
@Controller('manage/webhooks')
export class WebhooksController {
  constructor(private service: WebhooksService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) { return this.service.list(u.tenantId); }

  @Post()
  create(@CurrentUser() u: JwtPayload, @Body() body: CreateWebhookDto) {
    return this.service.create(u.tenantId, body);
  }

  @Patch(':id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: Partial<CreateWebhookDto> & { isActive?: boolean }) {
    return this.service.update(id, u.tenantId, body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, u.tenantId);
  }

  @Post(':id/test')
  test(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.test(id, u.tenantId);
  }
}
