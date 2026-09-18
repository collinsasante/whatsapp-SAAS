import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service-to-service auth for internal-only endpoints (e.g. the whatsapp-web
 * session-manager posting inbound events back to backend) -- never a JWT,
 * since the caller is another one of our own containers, not a logged-in
 * user. Checked against a shared secret header, not a route/tenant concept.
 *
 * Fails open with a loud warning when the key isn't configured, matching
 * this codebase's established pattern for optional-until-provisioned
 * secrets (CredentialsEncryptionService, WhatsApp webhook signatures) --
 * this ships before the secret exists in every environment without locking
 * anything out, and the risk is already contained by these routes never
 * being reachable from outside the internal Docker network in the first
 * place (no nginx route to them).
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('WHATSAPP_WEB_INTERNAL_API_KEY');
    if (!expected) {
      this.logger.warn('WHATSAPP_WEB_INTERNAL_API_KEY not configured -- internal auth is disabled');
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-internal-api-key'];
    if (provided !== expected) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
