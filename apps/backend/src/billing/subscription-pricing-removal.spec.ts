import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Monthly subscription sales are off (see subscription-sales.util.ts). The frontend and mobile apps have no test runner of their own,
 * so this guard reads their source from here. It fails if a subscription price, plan comparison or subscription purchase entry point
 * comes back into a customer-facing screen. Platform-admin screens are internal staff tools and are deliberately not scanned.
 * AI credit purchases and Commerce pricing are checked to still be there.
 */
const APPS = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(APPS, path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ['node_modules', '.next', '.expo', 'ios', 'android'].includes(name) ? [] : sourceFiles(path);
    return /\.(tsx?|mjs|css)$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
  });
}

const CUSTOMER_FACING = [
  ...sourceFiles(join(APPS, 'frontend', 'src')).filter((f) => !/\/platform-admin\/|\/components\/admin\/|\/lib\/admin(?:-api)?[./]/.test(f)),
  ...sourceFiles(join(APPS, 'mobile', 'app')),
  ...sourceFiles(join(APPS, 'mobile', 'src')),
].filter((f) => !/styles\/landing\.css$/.test(f)); // an unused legacy stylesheet that no page imports

describe('no subscription pricing or purchase entry point in customer-facing apps', () => {
  it('scans a meaningful set of files', () => {
    expect(CUSTOMER_FACING.length).toBeGreaterThan(100);
  });

  it.each([
    ['a dollar price per month or year', /\$\s?\d+(?:\.\d+)?\s*(?:\/|a |per )\s*(?:mo|month|yr|year)/i],
    ['a price field of a subscription plan', /\b(?:monthlyPrice|yearlyPrice|ghsMonthlyPrice|ghsYearlyPrice)\b/],
    ['a subscription checkout or plan-list API call', /billing(?:Api)?\.(?:getPlans|initiateStripeCheckout|initiatePaystackCheckout|applyPromoCode|startTrial)\b|['"`]\/billing\/(?:plans|checkout\/|promo|trial\/)/],
    ['a link to the removed pricing section', /#pricing\b/],
    ['an upgrade, subscribe or choose-a-plan call to action', />\s*(?:Upgrade|Subscribe(?: to [^<]*)?|Choose (?:Starter|Pro|a plan)|Start the 7-day trial|Renew Subscription)\s*</i],
  ])('has no %s', (_label, pattern) => {
    const hits = CUSTOMER_FACING.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => relative(APPS, f));
    expect(hits).toEqual([]);
  });

  it('the pricing section, its stylesheet and the unused pricing cards are gone', () => {
    for (const gone of ['frontend/src/components/site/Pricing.tsx', 'frontend/src/components/site/Pricing.module.css', 'frontend/src/components/ui/pricing-cards.tsx']) {
      expect(existsSync(join(APPS, gone))).toBe(false);
    }
  });

  describe('public site', () => {
    it('the landing page renders no pricing section and publishes no offer or price in its structured data', () => {
      const page = read('frontend/src/app/(landing)/page.tsx');
      expect(page).not.toMatch(/Pricing|PLANS|'Offer'|priceCurrency|offers:/);
    });

    it('the plan data and plan comparison rows are gone, and the FAQ no longer answers a cost or cancellation question', () => {
      const data = read('frontend/src/components/site/data.ts');
      expect(data).not.toMatch(/PLANS|PLAN_ROWS|PlanColumn|What does VerzChat cost|Can I cancel/);
    });

    it('navigation, footer and calls to action no longer point at plans', () => {
      for (const file of ['components/site/SiteNav.tsx', 'components/site/SiteFooter.tsx', 'components/site/Overview.tsx', 'components/site/FinalCta.tsx', 'components/site/Hero.tsx', 'components/site/Trust.tsx', 'app/(landing)/page.tsx']) {
        expect(read(`frontend/src/${file}`)).not.toMatch(/pricing|Compare the plans|upgrade|free plan/i);
      }
      expect(read('frontend/src/app/book-demo/page.tsx')).not.toMatch(/See the plans|#pricing/);
    });

    it('the terms of service state no subscription price', () => {
      expect(read('frontend/src/app/(legal)/terms/page.tsx')).not.toMatch(/\$\s?\d+\s*(?:\/|per )\s*(?:month|year)|Annual billing is/i);
    });
  });

  describe('billing screens (web and mobile)', () => {
    const web = read('frontend/src/app/(dashboard)/billing/page.tsx');
    const mobile = read('mobile/app/(app)/billing/index.tsx');

    it('show the current plan, usage, invoices and cancellation for existing workspaces', () => {
      for (const screen of [web, mobile]) {
        expect(screen).toMatch(/getUsage/);
        expect(screen).toMatch(/getInvoices/);
        expect(screen).toMatch(/cancelSubscription/);
      }
    });

    it('offer no plan list, plan card or subscription checkout', () => {
      expect(web).not.toMatch(/PlanCard|\bCheckoutModal\b|Available plans|publicPlans|Subscribe to/);
      expect(mobile).not.toMatch(/Available Plans|selectedPlan|checkoutMutation|Subscribe to|Proceed to Payment/);
    });

    it('keep AI credit packs, balance, usage and purchase fully available', () => {
      expect(web).toMatch(/getCreditPacks/);
      expect(web).toMatch(/getAiCredits/);
      expect(web).toMatch(/getCreditUsageSummary/);
      expect(web).toMatch(/getCreditTransactions/);
      expect(web).toMatch(/initiatePaystackCreditCheckout/);
      expect(web).toMatch(/CreditCheckoutModal/);
      expect(mobile).toMatch(/getCreditPacks/);
      expect(mobile).toMatch(/getAiCredits/);
      expect(mobile).toMatch(/initiatePaystackCreditCheckout/);
      expect(mobile).toMatch(/creditPurchaseMutation/);
    });
  });

  describe('API clients', () => {
    it('the web client keeps credit purchases and drops subscription purchases', () => {
      const api = read('frontend/src/lib/api.ts');
      const billingApi = api.slice(api.indexOf('export const billingApi'), api.indexOf('export const teamsApi'));
      expect(billingApi).toMatch(/getCreditPacks|initiatePaystackCreditCheckout|initiateStripeCreditCheckout/);
      expect(billingApi).not.toMatch(/getPlans|initiateStripeCheckout|initiatePaystackCheckout|applyPromoCode|startTrial/);
    });

    it('the shared client keeps credit purchases and drops subscription purchases', () => {
      const shared = readFileSync(join(APPS, '..', 'packages', 'api', 'src', 'endpoints', 'billing.ts'), 'utf8');
      expect(shared).toMatch(/initiatePaystackCreditCheckout/);
      expect(shared).not.toMatch(/getPlans|initiatePaystackCheckout\b/);
    });
  });

  describe('the credit-based model', () => {
    const aiPage = read('frontend/src/app/(dashboard)/ai/page.tsx');

    it('no customer screen says VerzAI needs a paid plan or a subscription', () => {
      const hits = CUSTOMER_FACING.filter((f) => /(?:need|require)[a-z ]*(?:an? )?(?:active )?paid plan|paid plan (?:is )?required|subscription is required/i.test(readFileSync(f, 'utf8'))).map((f) => relative(APPS, f));
      expect(hits).toEqual([]);
    });

    it('the AI page no longer describes a canned "a team member will follow up" reply', () => {
      expect(aiPage).not.toMatch(/lets them know a team member will follow up/);
      expect(aiPage).toContain("hands the conversation to your team");
    });

    it('the AI activation page does not make credits (or a plan) a condition of activating, and explains the paused state naturally', () => {
      expect(aiPage).not.toMatch(/needs AI credits|need(?:s)? (?:an? )?(?:active )?paid plan|credits are required to activate/i);
      expect(aiPage).toContain('Approve it to start replying. Replies are charged against your AI credits');
      expect(aiPage).toContain('VerzAI is on but paused: there are no credits left. It will reply again as soon as you top up.');
      expect(aiPage).toContain('as soon as your workspace has AI credits');
    });

    it('the dashboard business card shows a plan only for a workspace that still has a paid subscription, and links to billing and credits', () => {
      const card = read('frontend/src/components/dashboard/BusinessCard.tsx');
      expect(card).toMatch(/a\.subscriptionStatus && a\.plan\.toLowerCase\(\) !== 'free'/);
      expect(card).toContain('Billing and credits');
      expect(card).not.toContain('Manage plan');
    });

    it('the platform-admin plan screens say plainly that customers cannot buy a monthly plan', () => {
      expect(read('frontend/src/app/platform-admin/plans/page.tsx')).toContain('Customers cannot buy a monthly plan');
    });
  });

  describe('Commerce checkout and pricing are untouched', () => {
    it('the public Commerce payment page still exists and still takes payment', () => {
      const pay = read('frontend/src/app/pay/[reference]/page.tsx');
      expect(pay.length).toBeGreaterThan(500);
      expect(pay).toMatch(/pay|Pay/);
    });

    it('Commerce product and checkout code does not mention the subscription switch', () => {
      for (const dir of ['commerce/products', 'commerce/orders', 'commerce/public-checkout', 'commerce/webhooks']) {
        const files = sourceFiles(join(APPS, 'backend', 'src', dir)).filter((f) => !/\.spec\./.test(f));
        for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/SUBSCRIPTION_SALES|subscription-sales/);
      }
    });
  });
});
