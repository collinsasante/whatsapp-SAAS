export interface VerifiedPayment {
  gatewayPaymentId: string;
  gatewayReference: string;
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'pending';
  gatewayCustomerId?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedWebhookEvent {
  event: string;
  gatewayPaymentId?: string;
  gatewayReference?: string;
  gatewaySubscriptionId?: string;
  amount?: number;
  currency?: string;
  status?: 'success' | 'failed' | 'pending';
  metadata?: Record<string, unknown>;
  /** Present on renewal/subscription lifecycle events so the webhook handler can sync period dates */
  periodEnd?: Date;
  isRenewal?: boolean;
  isCanceled?: boolean;
}

export interface IBillingGateway {
  verifyWebhookSignature(payload: Buffer, signature: string): boolean;
  parseWebhookEvent(payload: Buffer): Promise<ParsedWebhookEvent>;
}
