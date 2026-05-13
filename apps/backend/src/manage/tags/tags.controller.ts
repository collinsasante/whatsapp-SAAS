import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { TagsService } from './tags.service';

@UseGuards(JwtAuthGuard)
@Controller('manage/tags')
export class TagsController {
  constructor(private service: TagsService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) { return this.service.list(u.tenantId); }

  @Post()
  create(@CurrentUser() u: JwtPayload, @Body() body: { name: string; color?: string }) {
    return this.service.create(u.tenantId, body.name, body.color);
  }

  @Patch(':id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { name?: string; color?: string }) {
    return this.service.update(id, u.tenantId, body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, u.tenantId);
  }
}
