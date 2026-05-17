export interface CheckoutSession {
  paymentUrl: string;
  gatewayReference: string;
  gatewayCustomerId?: string;
}

export interface VerifiedPayment {
  gatewayPaymentId: string;
  gatewayReference: string;
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'pending';
  gatewayCustomerId?: string;
  metadata?: Record<string, unknown>;
}

export interface IBillingGateway {
  createCheckoutSession(opts: {
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
  }): Promise<CheckoutSession>;

  verifyPayment(reference: string): Promise<VerifiedPayment>;

  verifyWebhookSignature(payload: Buffer, signature: string): boolean;

  parseWebhookEvent(payload: Buffer): Promise<{
    event: string;
    gatewayPaymentId?: string;
    gatewayReference?: string;
    amount?: number;
    currency?: string;
    status?: 'success' | 'failed' | 'pending';
    metadata?: Record<string, unknown>;
  }>;
}
