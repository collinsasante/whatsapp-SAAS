import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Locks internal testing/evaluation endpoints (AI Testing Center, AI/Commerce
 * Test Chat, Commerce Evaluation Runs) out of production. Unlike
 * InternalApiKeyGuard, this fails CLOSED by default -- the whole point is
 * that these routes are unreachable unless explicitly enabled, not merely
 * unconfigured-but-open. Set ENABLE_DEV_TOOLS=true only in non-production
 * environments (see infra/docker-compose.staging.yml).
 */
@Injectable()
export class DevToolsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.config.get<string>('ENABLE_DEV_TOOLS') === 'true';
    if (!enabled) {
      throw new ForbiddenException('This tool is not available in this environment.');
    }
    return true;
  }
}
