import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface MomoPaymentStatus {
  status: 'SUCCESSFUL' | 'PENDING' | 'FAILED';
  financialTransactionId?: string;
  reason?: string;
}

@Injectable()
export class MomoService {
  private readonly logger = new Logger(MomoService.name);

  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.isProduction
      ? 'https://proxy.momoapi.mtn.com'
      : 'https://sandbox.momodeveloper.mtn.com';
  }

  get isProduction(): boolean {
    return this.config.get<string>('MOMO_ENV', 'sandbox') === 'production';
  }

  private get subscriptionKey(): string {
    return this.config.get<string>('MOMO_COLLECTION_SUBSCRIPTION_KEY', '');
  }

  private get userId(): string {
    return this.config.get<string>('MOMO_USER_ID', '');
  }

  private get apiKey(): string {
    return this.config.get<string>('MOMO_API_KEY', '');
  }

  private get targetEnv(): string {
    return this.config.get<string>('MOMO_ENV', 'sandbox');
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const credentials = Buffer.from(`${this.userId}:${this.apiKey}`).toString('base64');
    const res = await axios.post(
      `${this.baseUrl}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      },
    );

    this.cachedToken = res.data.access_token as string;
    // Cache for (expires_in - 60) seconds
    this.tokenExpiry = Date.now() + ((res.data.expires_in as number) - 60) * 1000;
    return this.cachedToken;
  }

  async requestToPay(opts: {
    referenceId: string;
    phone: string;
    amount: number;
    currency: string;
    externalId: string;
    payerMessage: string;
    payeeNote: string;
    callbackUrl?: string;
  }): Promise<void> {
    const token = await this.getAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': opts.referenceId,
      'X-Target-Environment': this.targetEnv,
      'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      'Content-Type': 'application/json',
    };
    if (opts.callbackUrl) {
      headers['X-Callback-Url'] = opts.callbackUrl;
    }

    await axios.post(
      `${this.baseUrl}/collection/v1_0/requesttopay`,
      {
        amount: String(opts.amount),
        currency: opts.currency,
        externalId: opts.externalId,
        payer: { partyIdType: 'MSISDN', partyId: opts.phone },
        payerMessage: opts.payerMessage,
        payeeNote: opts.payeeNote,
      },
      { headers },
    );

    this.logger.log(`MoMo requesttopay sent: ${opts.referenceId} → ${opts.phone} ${opts.amount} ${opts.currency}`);
  }

  async getPaymentStatus(referenceId: string): Promise<MomoPaymentStatus> {
    const token = await this.getAccessToken();

    const res = await axios.get(
      `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.targetEnv,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      },
    );

    return {
      status: res.data.status as 'SUCCESSFUL' | 'PENDING' | 'FAILED',
      financialTransactionId: res.data.financialTransactionId,
      reason: (res.data.reason as { code?: string } | undefined)?.code,
    };
  }

  /** Normalize any Ghana phone format to MSISDN (e.g. 0551234567 → 233551234567) */
  normalizeMsisdn(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('233') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
    if (digits.length === 9) return `233${digits}`;
    // International format with country code already
    return digits;
  }

  /** Currency and amount to send to MTN based on environment */
  resolveAmountAndCurrency(usdAmount: number): { amount: number; currency: string } {
    if (this.isProduction) {
      const rate = parseFloat(this.config.get<string>('GHS_RATE', '12.5'));
      return { amount: Math.round(usdAmount * rate), currency: 'GHS' };
    }
    // Sandbox accepts EUR; we send the raw USD value (no real money involved)
    return { amount: usdAmount, currency: 'EUR' };
  }
}
