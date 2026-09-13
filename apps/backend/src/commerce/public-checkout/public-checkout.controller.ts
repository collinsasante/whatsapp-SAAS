import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { PublicCheckoutService } from './public-checkout.service';

/**
 * Deliberately unauthenticated -- the customer-facing branded checkout page
 * (apps/frontend/src/app/pay/[reference]) has no VerzChat login. Rate-limited
 * (not @SkipThrottle like the webhook) since this is a public, guessable-ish-
 * key-based endpoint, unlike the webhook which is signature-verified instead.
 * Never returns anything beyond what a customer already sees on their own
 * order -- no tenant internals, no other orders, no staff-only fields.
 */
@ApiExcludeController()
@Controller('pay')
export class PublicCheckoutController {
  constructor(private readonly checkout: PublicCheckoutService) {}

  @Get(':reference')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  get(@Param('reference') reference: string) {
    return this.checkout.getByReference(reference);
  }

  @Post(':reference/check-status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  checkStatus(@Param('reference') reference: string) {
    return this.checkout.checkStatus(reference);
  }
}
