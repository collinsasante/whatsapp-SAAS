import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { IBillingGateway, CheckoutSession, VerifiedPayment } from './gateway.interface';

@Injectable()
export class PaystackGateway implements IBillingGateway {
  private readonly logger = new Logger(PaystackGateway.name);
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = config.get<string>('PAYSTACK_SECRET_KEY', '');
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
    const res = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: opts.billingEmail,
        amount: Math.round(opts.amount * 100),
        currency: opts.currency.toUpperCase(),
        callback_url: opts.successUrl,
        metadata: {
          tenantId: opts.tenantId,
          invoiceId: opts.invoiceId,
          planSlug: opts.planSlug,
          ...opts.metadata,
        },
      },
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    return {
      paymentUrl: res.data.data.authorization_url,
      gatewayReference: res.data.data.reference,
    };
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const res = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    const txn = res.data.data;
    const status = txn.status === 'success' ? 'success'
      : txn.status === 'failed' ? 'failed' : 'pending';

    return {
      gatewayPaymentId: String(txn.id),
      gatewayReference: txn.reference,
      amount: txn.amount / 100,
      currency: txn.currency,
      status,
      gatewayCustomerId: txn.customer?.customer_code,
      metadata: txn.metadata,
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.secretKey) return false;
    const computed = crypto
      .createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');
    return computed === signature;
  }

  async parseWebhookEvent(payload: Buffer) {
    const event = JSON.parse(payload.toString('utf8'));
    const data = event.data ?? {};

    let status: 'success' | 'failed' | 'pending' | undefined;
    if (data.status === 'success') status = 'success';
    else if (data.status === 'failed') status = 'failed';

    return {
      event: event.event,
      gatewayPaymentId: String(data.id ?? ''),
      gatewayReference: data.reference,
      amount: data.amount != null ? data.amount / 100 : undefined,
      currency: data.currency,
      status,
      metadata: data.metadata,
    };
  }
}
