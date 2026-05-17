import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { IBillingGateway, CheckoutSession, VerifiedPayment } from './gateway.interface';

@Injectable()
export class FlutterwaveGateway implements IBillingGateway {
  private readonly logger = new Logger(FlutterwaveGateway.name);
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = config.get<string>('FLUTTERWAVE_SECRET_KEY', '');
    this.webhookSecret = config.get<string>('FLUTTERWAVE_WEBHOOK_SECRET', '');
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
    const txRef = `txn-${opts.invoiceId}-${Date.now()}`;

    const res = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: txRef,
        amount: opts.amount,
        currency: opts.currency.toUpperCase(),
        redirect_url: opts.successUrl,
        customer: { email: opts.billingEmail, name: opts.billingName },
        meta: { tenantId: opts.tenantId, invoiceId: opts.invoiceId, planSlug: opts.planSlug, ...opts.metadata },
        customizations: { title: `${opts.planSlug} Plan Subscription` },
      },
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    return {
      paymentUrl: res.data.data.link,
      gatewayReference: txRef,
    };
  }

  async verifyPayment(txRef: string): Promise<VerifiedPayment> {
    const res = await axios.get(
      `https://api.flutterwave.com/v3/transactions?tx_ref=${txRef}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    const txn = res.data.data?.[0];
    if (!txn) throw new Error(`Flutterwave transaction not found: ${txRef}`);

    const status = txn.status === 'successful' ? 'success'
      : txn.status === 'failed' ? 'failed' : 'pending';

    return {
      gatewayPaymentId: String(txn.id),
      gatewayReference: txn.tx_ref,
      amount: txn.amount,
      currency: txn.currency,
      status,
      metadata: txn.meta,
    };
  }

  verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;
    return signature === this.webhookSecret;
  }

  async parseWebhookEvent(payload: Buffer) {
    const event = JSON.parse(payload.toString('utf8'));
    const data = event.data ?? {};

    let status: 'success' | 'failed' | 'pending' | undefined;
    if (data.status === 'successful') status = 'success';
    else if (data.status === 'failed') status = 'failed';

    return {
      event: event.event,
      gatewayPaymentId: String(data.id ?? ''),
      gatewayReference: data.tx_ref,
      amount: data.amount,
      currency: data.currency,
      status,
      metadata: data.meta,
    };
  }
}
