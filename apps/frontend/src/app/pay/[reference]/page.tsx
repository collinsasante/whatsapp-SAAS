'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { ShieldCheck, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCcw } from 'lucide-react';
import { PaystackCheckoutButton } from '@/components/billing/GatewayCheckout';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type CheckoutState = 'AWAITING_PAYMENT' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED' | 'REVIEW_PENDING';

interface CheckoutSummary {
  reference: string;
  state: CheckoutState;
  currency: string;
  subtotalMajorUnits: number;
  totalMajorUnits: number;
  items: { name: string; quantity: number; unitPriceMajorUnits: number; lineTotalMajorUnits: number }[];
  business: { name: string; logoUrl: string | null };
  paystackAccessCode: string | null;
}

function formatMoney(amount: number, currency: string) {
  const symbol = currency === 'GHS' ? 'GH₵' : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

// Poll for the backend's own verified status after the popup reports success --
// the popup's callback is never treated as proof of payment on its own.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

export default function PublicCheckoutPage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;

  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await axios.get<CheckoutSummary>(`${API_URL}/pay/${reference}`);
      setSummary(res.data);
      return res.data;
    } catch {
      setLoadError("We couldn't find this payment link. It may have expired or the link may be incorrect.");
      return null;
    }
  }, [reference]);

  useEffect(() => { void load(); }, [load]);

  const pollStatus = useCallback(() => {
    setPolling(true);
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;

    const tick = async () => {
      try {
        const res = await axios.post<{ state: CheckoutState }>(`${API_URL}/pay/${reference}/check-status`);
        if (res.data.state !== 'AWAITING_PAYMENT' && res.data.state !== 'PROCESSING') {
          setPolling(false);
          await load();
          return;
        }
      } catch {
        // transient — keep polling until the deadline
      }
      if (Date.now() < pollDeadlineRef.current) {
        pollTimeoutRef.current = setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
      } else {
        setPolling(false);
        await load();
      }
    };
    void tick();
  }, [reference, load]);

  useEffect(() => () => { if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current); }, []);

  if (loadError) {
    return (
      <CenteredCard>
        <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-gray-900 text-center">Payment link not found</h1>
        <p className="text-sm text-gray-500 text-center mt-2">{loadError}</p>
      </CenteredCard>
    );
  }

  if (!summary) {
    return (
      <CenteredCard>
        <Loader2 className="w-8 h-8 text-teal-600 mx-auto mb-3 animate-spin" />
        <p className="text-sm text-gray-500 text-center">Loading your order…</p>
      </CenteredCard>
    );
  }

  const effectiveState: CheckoutState = polling ? 'PROCESSING' : summary.state;

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Business header */}
        <div className="flex items-center gap-3 mb-6">
          {summary.business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={summary.business.logoUrl} alt={summary.business.name} className="w-10 h-10 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center font-semibold text-sm">
              {summary.business.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-gray-900">{summary.business.name}</div>
            <div className="text-[11px] text-gray-400 flex items-center gap-1"><ShieldCheck size={11} /> Secure checkout</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <h1 className="text-base font-semibold text-gray-900">Complete your payment</h1>
            <p className="text-xs text-gray-500 mt-0.5">Order reference {summary.reference}</p>
          </div>

          <div className="px-6 py-5 space-y-3 border-b border-gray-100">
            {summary.items.map((item, i) => (
              <div key={i} className="flex items-start justify-between text-sm">
                <div>
                  <div className="text-gray-800">{item.name}</div>
                  <div className="text-[11px] text-gray-400">{item.quantity} × {formatMoney(item.unitPriceMajorUnits, summary.currency)}</div>
                </div>
                <div className="text-gray-700 font-medium">{formatMoney(item.lineTotalMajorUnits, summary.currency)}</div>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-50">
              <span className="text-gray-500">Subtotal</span>
              <span className="text-gray-700">{formatMoney(summary.subtotalMajorUnits, summary.currency)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold pt-1">
              <span className="text-gray-900">Total</span>
              <span className="text-gray-900">{formatMoney(summary.totalMajorUnits, summary.currency)}</span>
            </div>
          </div>

          <div className="px-6 py-5">
            {effectiveState === 'AWAITING_PAYMENT' && summary.paystackAccessCode && (
              <>
                <PaystackCheckoutButton
                  accessCode={summary.paystackAccessCode}
                  onSuccess={() => pollStatus()}
                  onError={(msg) => setPayError(msg)}
                />
                {payError && <p className="text-xs text-red-600 mt-2 text-center">{payError}</p>}
                <p className="text-[11px] text-gray-400 text-center mt-3">Secure payment powered by Paystack · Card · Mobile Money · Bank</p>
              </>
            )}

            {effectiveState === 'AWAITING_PAYMENT' && !summary.paystackAccessCode && (
              <StateMessage
                icon={<AlertTriangle className="w-8 h-8 text-amber-500" />}
                title="Payment not ready yet"
                body="This order hasn't been prepared for payment yet. Please contact the business for an updated payment link."
              />
            )}

            {effectiveState === 'PROCESSING' && (
              <StateMessage
                icon={<Loader2 className="w-8 h-8 text-teal-600 animate-spin" />}
                title="Payment processing…"
                body="Please don't close this window. We'll confirm as soon as it's ready."
              />
            )}

            {effectiveState === 'PAID' && (
              <StateMessage
                icon={<CheckCircle2 className="w-8 h-8 text-green-600" />}
                title="Payment successful"
                body="Your payment has been confirmed. The business will continue with your order shortly."
              />
            )}

            {effectiveState === 'FAILED' && (
              <>
                <StateMessage
                  icon={<XCircle className="w-8 h-8 text-red-500" />}
                  title="Payment wasn't completed"
                  body="Your order is still available. Please contact the business to try again."
                />
              </>
            )}

            {effectiveState === 'REVERSED' && (
              <StateMessage
                icon={<AlertTriangle className="w-8 h-8 text-amber-500" />}
                title="This payment was reversed"
                body="Please contact the business to sort out your order."
              />
            )}

            {effectiveState === 'REVIEW_PENDING' && (
              <StateMessage
                icon={<RefreshCcw className="w-8 h-8 text-gray-400" />}
                title="Your order is being reviewed"
                body="We'll send you a payment link as soon as it's ready."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">{children}</div>
    </div>
  );
}

function StateMessage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="text-center py-2">
      <div className="mb-3 flex justify-center">{icon}</div>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 mt-1.5">{body}</p>
    </div>
  );
}
