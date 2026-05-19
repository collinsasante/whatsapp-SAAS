import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { KnowledgeBaseService } from './knowledge-base.service';

@UseGuards(JwtAuthGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private service: KnowledgeBaseService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) {
    return this.service.list(u.tenantId);
  }

  @Post()
  create(@CurrentUser() u: JwtPayload, @Body() body: { title: string; content: string; isActive?: boolean }) {
    return this.service.create(u.tenantId, body);
  }

  @Patch(':id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { title?: string; content?: string; isActive?: boolean }) {
    return this.service.update(u.tenantId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(u.tenantId, id);
  }

  @Post('learn')
  learnFromConversations(@CurrentUser() u: JwtPayload) {
    return this.service.learnFromConversations(u.tenantId);
  }
}
