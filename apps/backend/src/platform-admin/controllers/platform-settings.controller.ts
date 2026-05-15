import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';
import { UpsertSettingDto } from '../dto/settings.dto';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/settings')
export class PlatformSettingsController {
  constructor(private service: PlatformAdminService) {}

  @Get()
  getAll() {
    return this.service.getSettings();
  }

  @Post()
  upsert(@Body() dto: UpsertSettingDto, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.upsertSetting(dto.key, dto.value, dto.description, admin.sub);
  }
}
