import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { IBillingGateway, ParsedWebhookEvent } from './gateway.interface';

interface PaystackChargeData {
  reference: string;
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'abandoned';
  customer?: { customer_code?: string };
  plan?: string | { plan_code?: string };
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaystackGateway implements IBillingGateway {
  private readonly logger = new Logger(PaystackGateway.name);
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY', '');
  }

  private get headers() {
    return { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' };
  }

  /**
   * Initializes a transaction and returns an access_code for the Paystack Inline popup
   * (`PaystackPop.resumeTransaction(accessCode)`) — no redirect, stays embedded in the page.
   * Passing `planCode` makes Paystack auto-create a recurring subscription on first charge.
   */
  async initializeTransaction(opts: {
    email: string;
    amountMajorUnits: number;
    currency: string;
    planCode?: string;
    tenantId: string;
    invoiceId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const res = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: opts.email,
        amount: Math.round(opts.amountMajorUnits * 100),
        currency: opts.currency.toUpperCase(),
        ...(opts.planCode && { plan: opts.planCode }),
        metadata: {
          tenantId: opts.tenantId,
          invoiceId: opts.invoiceId,
          ...opts.metadata,
        },
      },
      { headers: this.headers },
    );

    return {
      accessCode: res.data.data.access_code as string,
      gatewayReference: res.data.data.reference as string,
      gatewayCustomerId: '',
    };
  }

  async disableSubscription(subscriptionCode: string, emailToken: string): Promise<void> {
    await axios.post(
      'https://api.paystack.co/subscription/disable',
      { code: subscriptionCode, token: emailToken },
      { headers: this.headers },
    );
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.secretKey || !signature) return false;
    const computed = crypto.createHmac('sha512', this.secretKey).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(payload: Buffer): Promise<ParsedWebhookEvent> {
    const event = JSON.parse(payload.toString('utf8')) as { event: string; data: PaystackChargeData & Record<string, unknown> };
    const data = event.data;

    switch (event.event) {
      case 'charge.success': {
        const planCode = typeof data.plan === 'string' ? data.plan : data.plan?.plan_code;
        return {
          event: event.event,
          gatewayPaymentId: data.reference,
          gatewayReference: data.reference,
          gatewaySubscriptionId: planCode,
          amount: data.amount / 100,
          currency: data.currency,
          status: 'success',
          isRenewal: !!(data.metadata as Record<string, unknown> | undefined)?.['isRenewal'],
          metadata: { ...data.metadata, gatewayCustomerId: data.customer?.customer_code },
        };
      }
      case 'charge.failed':
        return { event: event.event, gatewayReference: data.reference, status: 'failed' };
      case 'subscription.disable':
        return { event: event.event, gatewaySubscriptionId: (data as unknown as { subscription_code?: string }).subscription_code, isCanceled: true };
      default:
        return { event: event.event };
    }
  }
}
