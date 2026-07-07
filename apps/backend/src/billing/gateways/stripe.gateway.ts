import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { IBillingGateway, ParsedWebhookEvent } from './gateway.interface';

@Injectable()
export class StripeGateway implements IBillingGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private readonly client: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY', ''), {
      apiVersion: '2025-02-24.acacia',
    });
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  /** Finds or creates the Stripe Customer for a tenant */
  async getOrCreateCustomer(opts: { existingCustomerId?: string | null; email: string; name: string; tenantId: string }): Promise<string> {
    if (opts.existingCustomerId) {
      try {
        const existing = await this.client.customers.retrieve(opts.existingCustomerId);
        if (!existing.deleted) return existing.id;
      } catch {
        // fall through and create a new one
      }
    }
    const customer = await this.client.customers.create({
      email: opts.email,
      name: opts.name,
      metadata: { tenantId: opts.tenantId },
    });
    return customer.id;
  }

  /**
   * Creates a subscription in `default_incomplete` state and returns the client secret
   * of its first invoice's PaymentIntent — the frontend confirms this via Stripe Elements.
   */
  async createSubscriptionCheckout(opts: {
    customerId: string;
    priceId: string;
    tenantId: string;
    invoiceId: string;
    planSlug: string;
  }) {
    const subscription = await this.client.subscriptions.create({
      customer: opts.customerId,
      items: [{ price: opts.priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { tenantId: opts.tenantId, invoiceId: opts.invoiceId, planSlug: opts.planSlug },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

    if (!paymentIntent?.client_secret) {
      throw new Error('Stripe did not return a PaymentIntent client secret for this subscription');
    }

    return {
      clientSecret: paymentIntent.client_secret,
      gatewayReference: paymentIntent.id,
      gatewayCustomerId: opts.customerId,
      stripeSubscriptionId: subscription.id,
    };
  }

  async cancelSubscription(stripeSubscriptionId: string, immediately: boolean): Promise<void> {
    if (immediately) {
      await this.client.subscriptions.cancel(stripeSubscriptionId);
    } else {
      await this.client.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
    }
  }

  /** One-off charge (e.g. AI credit packs) — not a subscription */
  async createOneOffPaymentIntent(opts: {
    customerId: string;
    amountMajorUnits: number;
    currency: string;
    tenantId: string;
    metadata?: Record<string, string>;
  }) {
    const pi = await this.client.paymentIntents.create({
      amount: Math.round(opts.amountMajorUnits * 100),
      currency: opts.currency.toLowerCase(),
      customer: opts.customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { tenantId: opts.tenantId, ...opts.metadata },
    });
    if (!pi.client_secret) throw new Error('Stripe did not return a PaymentIntent client secret');
    return { clientSecret: pi.client_secret, gatewayReference: pi.id };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.webhookSecret || !signature) return false;
    try {
      this.client.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    } catch (err) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(err as Error).message}`);
      return false;
    }
  }

  async parseWebhookEvent(payload: Buffer): Promise<ParsedWebhookEvent> {
    // Signature already verified by verifyWebhookSignature before this is called;
    // re-parsing here (without a signature) just decodes the JSON we already trust.
    const event = JSON.parse(payload.toString('utf8')) as Stripe.Event;
    const obj = event.data.object as unknown as Record<string, unknown>;

    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = obj as unknown as Stripe.Invoice;
        const line = invoice.lines?.data?.[0];
        return {
          event: event.type,
          gatewayPaymentId: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id,
          gatewayReference: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id,
          gatewaySubscriptionId: typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency?.toUpperCase(),
          status: 'success',
          isRenewal: invoice.billing_reason === 'subscription_cycle',
          periodEnd: line?.period?.end ? new Date(line.period.end * 1000) : undefined,
          metadata: invoice.metadata ?? undefined,
        };
      }
      case 'invoice.payment_failed': {
        const invoice = obj as unknown as Stripe.Invoice;
        return {
          event: event.type,
          gatewaySubscriptionId: typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id,
          status: 'failed',
          metadata: invoice.metadata ?? undefined,
        };
      }
      case 'customer.subscription.deleted': {
        const sub = obj as unknown as Stripe.Subscription;
        return {
          event: event.type,
          gatewaySubscriptionId: sub.id,
          isCanceled: true,
          metadata: sub.metadata ?? undefined,
        };
      }
      case 'payment_intent.succeeded': {
        const pi = obj as unknown as Stripe.PaymentIntent;
        return {
          event: event.type,
          gatewayPaymentId: pi.id,
          gatewayReference: pi.id,
          amount: pi.amount / 100,
          currency: pi.currency?.toUpperCase(),
          status: 'success',
          metadata: pi.metadata ?? undefined,
        };
      }
      case 'payment_intent.payment_failed': {
        const pi = obj as unknown as Stripe.PaymentIntent;
        return {
          event: event.type,
          gatewayPaymentId: pi.id,
          gatewayReference: pi.id,
          status: 'failed',
          metadata: pi.metadata ?? undefined,
        };
      }
      default:
        return { event: event.type };
    }
  }
}
