import type { AxiosInstance } from 'axios';

export function createBillingApi(client: AxiosInstance) {
  return {
    getStatus: () => client.get('/billing'),
    getPlans: () => client.get('/billing/plans'),
    getUsage: () => client.get('/billing/usage'),
    getInvoices: () => client.get('/billing/invoices'),
    getAiCredits: () => client.get('/billing/credits/balance'),
    getCreditPacks: () => client.get('/billing/credits/packs'),
    // NOTE: matches apps/backend/src/billing/billing.controller.ts's actual
    // routes -- /billing/checkout and /billing/credits/initialize (and the
    // momo/payment-confirmed methods removed below) do not exist on the
    // backend and were always 404ing.
    initiatePaystackCheckout: (data: { planSlug: string; cycle: string; billingEmail?: string; promoCode?: string }) =>
      client.post('/billing/checkout/paystack', data),
    initiatePaystackCreditCheckout: (data: { packSlug: string; billingEmail?: string }) =>
      client.post('/billing/credits/checkout/paystack', data),
    cancelSubscription: (immediately?: boolean) =>
      client.delete('/billing/cancel', { data: { immediately } }),
    updateBillingEmail: (billingEmail: string) =>
      client.post('/billing/email', { billingEmail }),
  };
}
