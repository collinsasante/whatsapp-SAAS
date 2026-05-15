import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/channels')
export class PlatformChannelsController {
  constructor(private service: PlatformAdminService) {}

  @Get()
  list(
    @Query('workspaceId') workspaceId?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listChannels({
      workspaceId,
      type,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
