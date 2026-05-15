import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PlatformAdminGuard extends AuthGuard('platform-admin-jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<T>(err: Error, user: T): T {
    if (err || !user) {
      throw new UnauthorizedException('Platform admin authentication required');
    }
    return user;
  }
}
