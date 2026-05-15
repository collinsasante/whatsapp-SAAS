import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PlatformAdminPayload } from '../strategies/platform-admin-jwt.strategy';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: PlatformAdminPayload }>();
    return request.user;
  },
);
