import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface PlatformAdminPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  type: 'platform_admin';
  iat?: number;
  exp?: number;
}

@Injectable()
export class PlatformAdminJwtStrategy extends PassportStrategy(Strategy, 'platform-admin-jwt') {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('app.jwtSecret', 'changeme');
    const adminSecret =
      configService.get<string>('PLATFORM_ADMIN_JWT_SECRET') || `${jwtSecret}_padmin`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: adminSecret,
    });
  }

  async validate(payload: PlatformAdminPayload): Promise<PlatformAdminPayload> {
    if (payload.type !== 'platform_admin') {
      throw new UnauthorizedException('Invalid admin token');
    }
    return payload;
  }
}
