import type { AxiosInstance } from 'axios';

export function createBillingApi(client: AxiosInstance) {
  return {
    getStatus: () => client.get('/billing'),
    getUsage: () => client.get('/billing/usage'),
    getInvoices: () => client.get('/billing/invoices'),
    getAiCredits: () => client.get('/billing/credits/balance'),
    getCreditPacks: () => client.get('/billing/credits/packs'),
    // NOTE: matches apps/backend/src/billing/billing.controller.ts's actual routes. Subscription plan listing and subscription
    // checkout are deliberately absent while subscription sales are off (the backend refuses them); AI credit purchases are unchanged.
    initiatePaystackCreditCheckout: (data: { packSlug: string; billingEmail?: string }) =>
      client.post('/billing/credits/checkout/paystack', data),
    cancelSubscription: (immediately?: boolean) =>
      client.delete('/billing/cancel', { data: { immediately } }),
    updateBillingEmail: (billingEmail: string) =>
      client.post('/billing/email', { billingEmail }),
  };
}
