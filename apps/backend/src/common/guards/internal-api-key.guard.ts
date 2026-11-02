import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { secretsMatch } from '../security/safe-equal.util';

/**
 * Service-to-service auth for internal-only endpoints (e.g. the whatsapp-web session-manager posting inbound events back to
 * backend) -- never a JWT, since the caller is another one of our own containers, not a logged-in user. Checked against a shared
 * secret header.
 *
 * Fails CLOSED in every environment: when WHATSAPP_WEB_INTERNAL_API_KEY is not configured, or the header is missing, empty or
 * wrong, the request is refused. Network location is not treated as authentication. The comparison is constant-time and the
 * secret is never logged.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('WHATSAPP_WEB_INTERNAL_API_KEY');
    if (!expected) {
      this.logger.error('WHATSAPP_WEB_INTERNAL_API_KEY is not configured; refusing internal request');
      throw new UnauthorizedException();
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-internal-api-key'];
    if (typeof provided !== 'string' || !secretsMatch(provided, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
