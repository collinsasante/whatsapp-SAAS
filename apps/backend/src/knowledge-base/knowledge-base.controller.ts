import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Post('deduplicate')
  deduplicate(@CurrentUser() u: JwtPayload) {
    return this.service.deduplicateArticles(u.tenantId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadFile(@CurrentUser() u: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.service.uploadFile(u.tenantId, file);
  }

  @Post('scrape')
  scrapeUrl(@CurrentUser() u: JwtPayload, @Body() body: { url: string }) {
    if (!body?.url) throw new BadRequestException('url is required');
    return this.service.scrapeUrl(u.tenantId, body.url);
  }
}
