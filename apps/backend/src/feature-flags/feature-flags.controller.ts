import {
  Controller, Get, Query, UseGuards,
} from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly svc: FeatureFlagsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyFlags(@CurrentTenant() tenantId: string) {
    return this.svc.getForTenant(tenantId);
  }

  @Get('check')
  checkFlag(@Query('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.svc.isEnabled(key, tenantId).then((enabled) => ({ key, enabled }));
  }
}
