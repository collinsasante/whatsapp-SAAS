import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { CannedResponsesService, CreateCannedDto, UpdateCannedDto } from './canned-responses.service';

@UseGuards(JwtAuthGuard)
@Controller('canned-responses')
export class CannedResponsesController {
  constructor(private service: CannedResponsesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantId);
  }

  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query('q') q = '') {
    return this.service.search(user.tenantId, q);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCannedDto) {
    return this.service.create(user.tenantId, user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCannedDto) {
    return this.service.update(id, user.tenantId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, user.tenantId);
  }
}
