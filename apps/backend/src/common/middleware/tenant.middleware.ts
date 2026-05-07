import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async use(req: Request & { tenantId?: string }, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const payload = await this.jwtService.verifyAsync<{ tenantId: string }>(token, {
          secret: this.configService.get<string>('app.jwtSecret'),
        });
        req.tenantId = payload.tenantId;
      } catch {
        // will be caught by auth guard
      }
    }

    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenantId && !req.tenantId) {
      req.tenantId = headerTenantId;
    }

    next();
  }
}
