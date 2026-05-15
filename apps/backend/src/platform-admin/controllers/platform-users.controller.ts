import { Controller, Get, Post, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../services/platform-admin.service';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';
import { ListUsersDto } from '../dto/workspace-action.dto';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/users')
export class PlatformUsersController {
  constructor(private service: PlatformAdminService) {}

  @Get()
  list(@Query() query: ListUsersDto) {
    return this.service.listUsers(query);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.suspendUser(id, admin.sub);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.reactivateUser(id, admin.sub);
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  forceLogout(@Param('id') id: string, @CurrentAdmin() admin: PlatformAdminPayload) {
    return this.service.forceLogoutUser(id, admin.sub);
  }
}
