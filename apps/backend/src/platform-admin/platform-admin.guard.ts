import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private jwtService: JwtService, private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing admin token');

    const token = authHeader.slice(7);
    try {
      const payload = this.jwtService.verify<{ sub: string; role: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      if (payload.role !== 'platform_admin') throw new UnauthorizedException();
      (request as Request & { adminId: string }).adminId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }
  }
}
