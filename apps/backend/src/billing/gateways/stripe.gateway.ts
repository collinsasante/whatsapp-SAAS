import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { IBillingGateway, CheckoutSession, VerifiedPayment } from './gateway.interface';

@Injectable()
export class StripeGateway implements IBillingGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = config.get<string>('STRIPE_SECRET_KEY', '');
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  async createCheckoutSession(opts: {
    tenantId: string;
    planSlug: string;
    amount: number;
    currency: string;
    billingEmail: string;
    billingName: string;
    invoiceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<CheckoutSession> {
    const params = new URLSearchParams({
      'payment_method_types[]': 'card',
      'mode': 'payment',
      'customer_email': opts.billingEmail,
      'line_items[0][price_data][currency]': opts.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(opts.amount * 100)),
      'line_items[0][price_data][product_data][name]': `${opts.planSlug} Plan`,
      'line_items[0][quantity]': '1',
      'success_url': opts.successUrl,
      'cancel_url': opts.cancelUrl,
      'metadata[tenantId]': opts.tenantId,
      'metadata[invoiceId]': opts.invoiceId,
      'metadata[planSlug]': opts.planSlug,
    });

    if (opts.metadata) {
      for (const [k, v] of Object.entries(opts.metadata)) {
        params.set(`metadata[${k}]`, v);
      }
    }

    const res = await axios.post(
      'https://api.stripe.com/v1/checkout/sessions',
      params.toString(),
      {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    return {
      paymentUrl: res.data.url,
      gatewayReference: res.data.id,
    };
  }

  async verifyPayment(sessionId: string): Promise<VerifiedPayment> {
    const res = await axios.get(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    const session = res.data;
    const status = session.payment_status === 'paid' ? 'success'
      : session.payment_status === 'unpaid' ? 'pending' : 'failed';

    return {
      gatewayPaymentId: session.payment_intent ?? session.id,
      gatewayReference: session.id,
      amount: session.amount_total / 100,
      currency: session.currency.toUpperCase(),
      status,
      metadata: session.metadata,
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;
    try {
      const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {});
      const timestamp = parts['t'];
      const expectedSig = parts['v1'];
      const signedPayload = `${timestamp}.${payload.toString('utf8')}`;
      const computed = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedPayload)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig ?? ''));
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(payload: Buffer) {
    const event = JSON.parse(payload.toString('utf8'));
    const obj = event.data?.object ?? {};

    let status: 'success' | 'failed' | 'pending' | undefined;
    if (obj.payment_status === 'paid' || obj.status === 'succeeded') status = 'success';
    else if (obj.status === 'requires_payment_method') status = 'failed';

    return {
      event: event.type,
      gatewayPaymentId: obj.payment_intent ?? obj.id,
      gatewayReference: obj.id,
      amount: obj.amount_total != null ? obj.amount_total / 100 : obj.amount != null ? obj.amount / 100 : undefined,
      currency: obj.currency?.toUpperCase(),
      status,
      metadata: obj.metadata,
    };
  }
}
