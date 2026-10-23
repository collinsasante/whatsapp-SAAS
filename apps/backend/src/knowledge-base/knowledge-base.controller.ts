import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { KnowledgeBaseService } from './knowledge-base.service';

// Reading is open to every workspace member. Everything that changes the shared knowledge base, or makes a paid
// or outbound request on the workspace's behalf, is admin-only (the role comes from the database, see JwtStrategy).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private service: KnowledgeBaseService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) {
    return this.service.list(u.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() u: JwtPayload, @Body() body: { title: string; content: string; isActive?: boolean }) {
    return this.service.create(u.tenantId, body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { title?: string; content?: string; isActive?: boolean }) {
    return this.service.update(u.tenantId, id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(u.tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('learn')
  learnFromConversations(@CurrentUser() u: JwtPayload) {
    return this.service.learnNow(u.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post('deduplicate')
  deduplicate(@CurrentUser() u: JwtPayload) {
    return this.service.deduplicateArticles(u.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadFile(@CurrentUser() u: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.service.uploadFile(u.tenantId, file);
  }

  @Roles(UserRole.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('scrape')
  scrapeUrl(@CurrentUser() u: JwtPayload, @Body() body: { url: string }) {
    if (!body?.url) throw new BadRequestException('url is required');
    return this.service.scrapeUrl(u.tenantId, body.url);
  }
}
