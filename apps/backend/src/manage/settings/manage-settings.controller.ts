import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { ManageSettingsService } from './manage-settings.service';

@UseGuards(JwtAuthGuard)
@Controller('manage/settings')
export class ManageSettingsController {
  constructor(private service: ManageSettingsService) {}

  @Get()
  get(@CurrentUser() u: JwtPayload) { return this.service.get(u.tenantId); }

  @Patch('welcome')
  updateWelcome(@CurrentUser() u: JwtPayload, @Body() body: { welcomeEnabled?: boolean; welcomeMessage?: string }) {
    return this.service.updateWelcome(u.tenantId, body);
  }

  @Patch('off-hours')
  updateOffHours(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateOffHours(u.tenantId, body);
  }

  @Patch('opt-in-out')
  updateOptInOut(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateOptInOut(u.tenantId, body);
  }

  @Patch('widget')
  updateWidget(@CurrentUser() u: JwtPayload, @Body() body: any) {
    return this.service.updateWidget(u.tenantId, body);
  }

  @Patch('ai')
  updateAi(@CurrentUser() u: JwtPayload, @Body() body: { aiEnabled?: boolean; aiAlwaysOn?: boolean; aiPersonality?: string }) {
    return this.service.updateAi(u.tenantId, body);
  }
}
