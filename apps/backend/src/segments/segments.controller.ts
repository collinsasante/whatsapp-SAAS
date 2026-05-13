import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { SegmentsService, SegmentFilter } from './segments.service';

@UseGuards(JwtAuthGuard)
@Controller('segments')
export class SegmentsController {
  constructor(private service: SegmentsService) {}

  @Get()
  list(@CurrentUser() u: JwtPayload) { return this.service.list(u.tenantId); }

  @Post()
  create(@CurrentUser() u: JwtPayload, @Body() body: { name: string; description?: string; filters: SegmentFilter[] }) {
    return this.service.create(u.tenantId, body);
  }

  @Patch(':id')
  update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() body: { name?: string; description?: string; filters?: SegmentFilter[] }) {
    return this.service.update(id, u.tenantId, body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.remove(id, u.tenantId);
  }

  @Post(':id/refresh-count')
  refreshCount(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.refreshCount(id, u.tenantId);
  }
}
