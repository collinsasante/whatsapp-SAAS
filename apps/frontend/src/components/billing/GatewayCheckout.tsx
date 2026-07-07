'use client';
import { useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { cn } from '@/lib/utils';

// ─── Stripe (embedded Elements) ───────────────────────────────────────────────

const stripeInstances = new Map<string, Promise<StripeJs | null>>();
function getStripe(publishableKey: string) {
  let instance = stripeInstances.get(publishableKey);
  if (!instance) {
    instance = loadStripe(publishableKey);
    stripeInstances.set(publishableKey, instance);
  }
  return instance;
}

function StripePayButton({ onSuccess, onError }: { onSuccess: () => void; onError: (msg: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setSubmitting(false);
    if (error) {
      onError(error.message ?? 'Payment failed');
      return;
    }
    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      onSuccess();
    } else {
      onError('Payment was not completed');
    }
  };

  return (
    <button
      onClick={() => { void handleSubmit(); }}
      disabled={submitting || !stripe}
      className={cn(
        'w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700',
        'disabled:opacity-60 transition-colors text-sm flex items-center justify-center gap-2',
      )}
    >
      {submitting
        ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Processing…</>
        : 'Pay now'}
    </button>
  );
}

export function StripeCheckout({ clientSecret, publishableKey, onSuccess, onError }: {
  clientSecret: string;
  publishableKey: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [elementsError, setElementsError] = useState<string | null>(null);
  return (
    <Elements stripe={getStripe(publishableKey)} options={{ clientSecret }}>
      <div className="space-y-4">
        <PaymentElement onLoadError={(e) => setElementsError(e.error.message ?? 'Failed to load payment form')} />
        {elementsError && <p className="text-xs text-red-600">{elementsError}</p>}
        <StripePayButton onSuccess={onSuccess} onError={onError} />
      </div>
    </Elements>
  );
}

// ─── Paystack (embedded Inline popup) ─────────────────────────────────────────

interface PaystackTransaction { reference: string; status: string }
interface PaystackPopInstance {
  resumeTransaction: (accessCode: string, callbacks: {
    onSuccess?: (transaction: PaystackTransaction) => void;
    onCancel?: () => void;
    onError?: (error: { message: string }) => void;
  }) => void;
}
declare global {
  interface Window {
    PaystackPop?: { new (): PaystackPopInstance };
  }
}

let paystackScriptPromise: Promise<void> | null = null;
function loadPaystackScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.PaystackPop) return Promise.resolve();
  if (!paystackScriptPromise) {
    paystackScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v2/inline.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Paystack'));
      document.body.appendChild(script);
    });
  }
  return paystackScriptPromise;
}

export function PaystackCheckoutButton({ accessCode, onSuccess, onError }: {
  accessCode: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await loadPaystackScript();
      const popup = new window.PaystackPop!();
      popup.resumeTransaction(accessCode, {
        onSuccess: () => { setLoading(false); onSuccess(); },
        onCancel: () => { setLoading(false); },
        onError: (error) => { setLoading(false); onError(error.message ?? 'Payment failed'); },
      });
    } catch (err) {
      setLoading(false);
      onError((err as Error).message);
    }
  };

  return (
    <button
      onClick={() => { void handleClick(); }}
      disabled={loading}
      className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors text-sm flex items-center justify-center gap-2"
    >
      {loading
        ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Opening Paystack…</>
        : 'Pay with Paystack'}
    </button>
  );
}
