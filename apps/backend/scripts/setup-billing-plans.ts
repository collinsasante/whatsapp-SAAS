/**
 * One-off provisioning script: creates the matching Stripe Products/Prices and
 * Paystack Plans for every paid Plan row in the database, then stores the
 * returned IDs back onto the Plan so checkout can reference them.
 *
 * Run once after setting real STRIPE_SECRET_KEY / PAYSTACK_SECRET_KEY in your
 * environment (and after setting ghsMonthlyPrice/ghsYearlyPrice on each Plan
 * for Paystack, since Paystack charges in GHS here while Stripe charges USD):
 *
 *   pnpm --filter @whatsapp-platform/backend run billing:setup-plans
 */
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import axios from 'axios';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2025-02-24.acacia' });
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY ?? '';

async function ensureStripePrices(plan: {
  id: string; slug: string; name: string; monthlyPrice: number; yearlyPrice: number; currency: string;
  stripePriceIdMonthly: string | null; stripePriceIdYearly: string | null;
}) {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log(`  ⏭  Skipping Stripe for "${plan.slug}" — STRIPE_SECRET_KEY not set`);
    return {};
  }
  if (plan.stripePriceIdMonthly && plan.stripePriceIdYearly) {
    console.log(`  ✓  Stripe prices already provisioned for "${plan.slug}"`);
    return {};
  }

  const product = await stripe.products.create({ name: `VerzChat ${plan.name} Plan`, metadata: { planSlug: plan.slug } });

  const monthly = await stripe.prices.create({
    product: product.id,
    currency: plan.currency.toLowerCase(),
    unit_amount: Math.round(plan.monthlyPrice * 100),
    recurring: { interval: 'month' },
    metadata: { planSlug: plan.slug },
  });

  const yearly = await stripe.prices.create({
    product: product.id,
    currency: plan.currency.toLowerCase(),
    unit_amount: Math.round(plan.yearlyPrice * 100),
    recurring: { interval: 'year' },
    metadata: { planSlug: plan.slug },
  });

  console.log(`  ✓  Created Stripe product + prices for "${plan.slug}"`);
  return { stripePriceIdMonthly: monthly.id, stripePriceIdYearly: yearly.id };
}

async function ensurePaystackPlans(plan: {
  slug: string; name: string; ghsMonthlyPrice: number | null; ghsYearlyPrice: number | null;
  paystackPlanCodeMonthly: string | null; paystackPlanCodeYearly: string | null;
}) {
  if (!paystackSecretKey) {
    console.log(`  ⏭  Skipping Paystack for "${plan.slug}" — PAYSTACK_SECRET_KEY not set`);
    return {};
  }
  if (!plan.ghsMonthlyPrice || !plan.ghsYearlyPrice) {
    console.log(`  ⚠  Skipping Paystack for "${plan.slug}" — set ghsMonthlyPrice/ghsYearlyPrice on this Plan first`);
    return {};
  }
  if (plan.paystackPlanCodeMonthly && plan.paystackPlanCodeYearly) {
    console.log(`  ✓  Paystack plans already provisioned for "${plan.slug}"`);
    return {};
  }

  const headers = { Authorization: `Bearer ${paystackSecretKey}`, 'Content-Type': 'application/json' };

  const monthly = await axios.post(
    'https://api.paystack.co/plan',
    { name: `VerzChat ${plan.name} (Monthly)`, amount: Math.round(plan.ghsMonthlyPrice * 100), currency: 'GHS', interval: 'monthly' },
    { headers },
  );
  const yearly = await axios.post(
    'https://api.paystack.co/plan',
    { name: `VerzChat ${plan.name} (Yearly)`, amount: Math.round(plan.ghsYearlyPrice * 100), currency: 'GHS', interval: 'annually' },
    { headers },
  );

  console.log(`  ✓  Created Paystack plans for "${plan.slug}"`);
  return {
    paystackPlanCodeMonthly: monthly.data.data.plan_code as string,
    paystackPlanCodeYearly: yearly.data.data.plan_code as string,
  };
}

async function main() {
  const plans = await prisma.plan.findMany({ where: { monthlyPrice: { gt: 0 } } });
  console.log(`Found ${plans.length} paid plan(s) to provision.\n`);

  for (const plan of plans) {
    console.log(`Plan: ${plan.slug}`);
    const [stripeIds, paystackIds] = await Promise.all([
      ensureStripePrices(plan),
      ensurePaystackPlans(plan),
    ]);

    const updates = { ...stripeIds, ...paystackIds };
    if (Object.keys(updates).length > 0) {
      await prisma.plan.update({ where: { id: plan.id }, data: updates });
    }
    console.log('');
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
