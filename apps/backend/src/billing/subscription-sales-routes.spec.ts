import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * While subscription sales are off, no backend route may start a subscription. Three independent checks:
 *  1. the complete list of billing routes is pinned, so a new route has to be reviewed against the switch;
 *  2. every route that starts a subscription is refused through the REAL controller and service;
 *  3. only the gated BillingService methods (and the payment webhook, which can only complete a payment that was already started)
 *     are allowed to call the subscription-creating methods anywhere in the backend.
 */
const METHOD_NAMES: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT' };

function routesOf(controller: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (controller.prototype as Record<string, unknown>)[name] as object;
      const path = Reflect.getMetadata('path', handler);
      const method = Reflect.getMetadata('method', handler);
      return path === undefined ? null : `${METHOD_NAMES[method]} /${path === '/' ? '' : path}`.trim();
    })
    .filter((r): r is string => r !== null)
    .sort();
}

describe('billing routes and the subscription-sales switch', () => {
  it('pins the full list of customer billing routes', () => {
    expect(routesOf(BillingController)).toEqual([
      'DELETE /cancel',
      'GET /',
      'GET /credits/balance',
      'GET /credits/packs',
      'GET /credits/transactions',
      'GET /credits/usage',
      'GET /invoices',
      'GET /plans',
      'GET /usage',
      'GET /usage/history',
      'POST /checkout/paystack',
      'POST /checkout/stripe',
      'POST /credits/checkout/paystack',
      'POST /credits/checkout/stripe',
      'POST /email',
      'POST /promo',
      'POST /trial/:planSlug',
    ]);
  });

  describe('every route that starts or prices a subscription is closed while the switch is off', () => {
    function controllerWithSalesOff() {
      const prisma = { plan: { findUnique: jest.fn() }, tenant: { findUnique: jest.fn() } };
      const subscriptionService = { startTrial: jest.fn(), createCheckoutInvoice: jest.fn(), getPlans: jest.fn(), getOrCreateFreeTrial: jest.fn() };
      const service = Object.create(BillingService.prototype) as Record<string, unknown>;
      Object.assign(service, { prisma, subscriptionService, stripeGateway: {}, paystackGateway: {}, config: { get: jest.fn().mockReturnValue(undefined) } });
      return { controller: new BillingController(service as unknown as BillingService), prisma, subscriptionService };
    }
    const dto = { planSlug: 'pro', cycle: 'MONTHLY' as never };
    const user = { sub: 'u1' } as never;

    it.each([
      ['POST /checkout/stripe', (c: BillingController) => c.initiateStripeCheckout('t1', dto, user)],
      ['POST /checkout/paystack', (c: BillingController) => c.initiatePaystackCheckout('t1', dto, user)],
      ['POST /promo', (c: BillingController) => c.applyPromoCode('t1', { code: 'SAVE', planSlug: 'pro' } as never)],
      ['POST /trial/:planSlug', (c: BillingController) => Promise.resolve().then(() => c.startTrial('t1', 'pro'))],
    ])('%s answers 403 and starts nothing', async (_route, call) => {
      const { controller, prisma, subscriptionService } = controllerWithSalesOff();
      await expect(call(controller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.plan.findUnique).not.toHaveBeenCalled();
      expect(subscriptionService.startTrial).not.toHaveBeenCalled();
      expect(subscriptionService.createCheckoutInvoice).not.toHaveBeenCalled();
    });

    it('GET /plans lists nothing', async () => {
      const { controller, subscriptionService } = controllerWithSalesOff();
      expect(await controller.getPlans()).toEqual([]);
      expect(subscriptionService.getPlans).not.toHaveBeenCalled();
    });
  });

  describe('no other code path can start a subscription', () => {
    const root = join(__dirname, '..');
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
    const all = files(root);
    const callers = (re: RegExp) => all.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f)).sort();

    it('only BillingService (whose methods assert the switch) reaches the subscription-creating methods', () => {
      expect(callers(/subscriptionService\.startTrial\(/)).toEqual(['billing/billing.service.ts']);
      expect(callers(/subscriptionService\.createCheckoutInvoice\(/)).toEqual(['billing/billing.service.ts']);
    });

    it('only the payment webhook activates a subscription, and only for a payment that was started earlier', () => {
      expect(callers(/\.activateFromPayment\(/)).toEqual(['billing/billing-webhook.controller.ts']);
    });

    it('each BillingService method that starts something asserts the switch first', () => {
      const source = readFileSync(join(root, 'billing', 'billing.service.ts'), 'utf8');
      for (const method of ['initiateStripeCheckout', 'initiatePaystackCheckout', 'applyPromoCode', 'startTrial']) {
        const body = source.slice(source.search(new RegExp(`\\b(?:async )?${method}\\(`)));
        expect(body.split('\n').slice(0, 3).join('\n')).toContain('this.assertSubscriptionSalesEnabled()');
      }
    });

    it('no other module can mint a subscription row', () => {
      const writers = all.filter((f) => !/^billing\//.test(relative(root, f)) && !/platform-admin\//.test(relative(root, f)))
        .filter((f) => /subscription\.(create|upsert)\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
      expect(writers).toEqual([]);
    });
  });
});
