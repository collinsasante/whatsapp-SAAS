import {
  Controller, Post, Get, Patch, Body, Param, Query,
  Ip, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DemoService } from './demo.service';
import { CreateDemoDto } from './dto/create-demo.dto';
import { UpdateDemoDto, AddNoteDto } from './dto/update-demo.dto';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';

// ── Public endpoints ─────────────────────────────────────────────────────────

@Controller('demo')
export class DemoController {
  constructor(private readonly service: DemoService) {}

  @Get('slots')
  getSlots(@Query('date') date: string) {
    return this.service.getAvailableSlots(date);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  create(@Body() dto: CreateDemoDto, @Ip() ip: string) {
    return this.service.create(dto, ip);
  }
}

// ── Platform-admin endpoints ─────────────────────────────────────────────────

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/demos')
export class DemoAdminController {
  constructor(private readonly service: DemoService) {}

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      status,
      tier,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateDemoDto) {
    return this.service.updateStatus(id, dto.status!, dto.changedBy);
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() dto: AddNoteDto) {
    return this.service.addNote(id, dto.content, dto.authorName);
  }
}
