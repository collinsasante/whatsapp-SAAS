import type { AxiosInstance } from 'axios';

export function createBillingApi(client: AxiosInstance) {
  return {
    getStatus: () => client.get('/billing'),
    getPlans: () => client.get('/billing/plans'),
    getUsage: () => client.get('/billing/usage'),
    getInvoices: () => client.get('/billing/invoices'),
    getAiCredits: () => client.get('/billing/credits/balance'),
    getCreditPacks: () => client.get('/billing/credits/packs'),
    initiateCheckout: (data: { planSlug: string; cycle: string; billingEmail?: string }) =>
      client.post('/billing/checkout', data),
    initializeCreditPurchase: (packSlug: string) =>
      client.post('/billing/credits/initialize', { packSlug }),
    cancelSubscription: (immediately?: boolean) =>
      client.delete('/billing/cancel', { data: { immediately } }),
    updateBillingEmail: (billingEmail: string) =>
      client.post('/billing/email', { billingEmail }),
    notifyPaymentConfirmed: (reference: string) =>
      client.post('/billing/payment-confirmed', { reference }),
    initiateMomoCheckout: (data: {
      planSlug: string;
      cycle: string;
      momoPhone: string;
      billingEmail?: string;
    }) => client.post('/billing/momo/request', data),
    getMomoStatus: (referenceId: string) =>
      client.get(`/billing/momo/status/${referenceId}`),
  };
}
