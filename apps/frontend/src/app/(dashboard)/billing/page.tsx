'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, BarChart3, Bot, Check, CheckCircle2,
  CreditCard, Download, Mail, RefreshCw, Sparkles, Tag, Users, X, Zap,
} from 'lucide-react';
import { billingApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

// Paystack Inline type shim
declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: {
        key: string; email: string; amount: number; currency: string;
        ref: string; metadata?: Record<string, unknown>;
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      }) => { openIframe: () => void };
    };
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface Plan {
  id: string; slug: string; name: string; description: string | null;
  monthlyPrice: number; yearlyPrice: number; currency: string;
  trialDays: number; isActive: boolean;
  limMaxAgents: number; limMaxChannels: number; limMaxContacts: number;
  limMaxTemplates: number; limMessagesPerMonth: number;
  limMaxCampaigns: number; limAiCreditsPerMonth: number; limStorageGb: number;
  features: string[];
}

interface Subscription {
  id: string; planId: string; status: string; cycle: string;
  trialEndsAt: string | null; currentPeriodStart: string; currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean; canceledAt: string | null;
  plan: Plan;
}

interface BillingStatus {
  subscription: Subscription;
  plan: Plan;
  billingEmail: string | null;
  workspaceName: string;
}

interface UsageLimits {
  maxAgents: number; maxChannels: number; maxContacts: number;
  maxTemplates: number; messagesPerMonth: number;
  maxCampaigns: number; aiCreditsPerMonth: number; storageGb: number;
}

interface UsageData {
  periodStart: string;
  messagesSent: number; messagesReceived: number;
  conversationsOpened: number; campaignsSent: number;
  aiCreditsUsed: number; activeAgents: number; activeChannels: number;
  totalContacts: number; totalTemplates: number;
}

interface UsageResponse { usage: UsageData; limits: UsageLimits; }

interface Invoice {
  id: string; invoiceNumber: string; status: string;
  subtotal: number; tax: number; discount: number; total: number;
  currency: string; billingPeriodStart: string; billingPeriodEnd: string;
  dueDate: string; paidAt: string | null; gateway: string | null;
  gatewayPaymentUrl: string | null; createdAt: string;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
}

interface PromoPreview {
  code: string; discountType: string; discountValue: number;
  monthlyDiscount: number; yearlyDiscount: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-teal-100 text-teal-700',
  TRIAL:     'bg-blue-100 text-blue-700',
  PAST_DUE:  'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  CANCELED:  'bg-gray-100 text-gray-600',
  EXPIRED:   'bg-gray-100 text-gray-500',
};

const GATEWAY_INFO: Record<string, { label: string; color: string }> = {
  STRIPE:       { label: 'Stripe',       color: 'bg-indigo-600' },
  PAYSTACK:     { label: 'Paystack',     color: 'bg-teal-600' },
  FLUTTERWAVE:  { label: 'Flutterwave',  color: 'bg-yellow-500' },
};

// ─── UsageBar ───────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit, color }: { label: string; used: number; limit: number; color: string }) {
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const warning = !unlimited && pct >= 85;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className={cn('font-semibold', warning ? 'text-red-600' : 'text-gray-500')}>
          {unlimited ? <span className="text-teal-600 font-semibold">Unlimited</span>
            : <>{used.toLocaleString()} / {limit.toLocaleString()}</>}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', warning ? 'bg-red-500' : color)}
            style={{ width: `${pct}%` }} />
        </div>
      )}
      {warning && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle size={10} /> {pct}% used
        </p>
      )}
    </div>
  );
}

// ─── CheckoutModal ──────────────────────────────────────────────────────────

function CheckoutModal({ plan, initialEmail, onClose, onSuccess }: {
  plan: Plan; initialEmail?: string; onClose: () => void; onSuccess: () => void;
}) {
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [promoCode, setPromoCode] = useState('');
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);
  const [promoError, setPromoError] = useState('');
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [loading, setLoading] = useState(false);

  const isUsd = plan.currency === 'USD' || !plan.currency;
  const currencySymbol = isUsd ? '$' : 'GH₵';

  function fmtPrice(p: number) { return `${currencySymbol}${p.toFixed(2)}`; }

  const basePrice = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
  const discount = promoPreview ? (cycle === 'YEARLY' ? promoPreview.yearlyDiscount : promoPreview.monthlyDiscount) : 0;
  const finalPrice = Math.max(0, basePrice - discount);

  const handleCheckPromo = async () => {
    if (!promoCode.trim()) return;
    setCheckingPromo(true);
    setPromoError('');
    try {
      const res = await billingApi.applyPromoCode(promoCode.trim(), plan.slug);
      setPromoPreview(res.data as PromoPreview);
    } catch {
      setPromoError('Invalid or expired promo code');
      setPromoPreview(null);
    } finally { setCheckingPromo(false); }
  };

  const handleCheckout = async () => {
    if (!email.trim()) { toast.error('Enter a billing email'); return; }
    setLoading(true);
    try {
      const res = await billingApi.initiateCheckout({
        planSlug: plan.slug,
        cycle,
        gateway: 'PAYSTACK',
        billingEmail: email.trim(),
        promoCode: promoPreview?.code,
      });
      const data = res.data as { paymentUrl: string | null; reference?: string; free: boolean };

      if (data.free) {
        toast.success(`${plan.name} plan activated!`);
        onSuccess();
        return;
      }

      const paystackKey = process.env['NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY'] ?? '';

      // Use Paystack Inline popup — stays on our page
      if (data.reference && paystackKey && window.PaystackPop) {
        window.PaystackPop.setup({
          key: paystackKey,
          email: email.trim(),
          amount: Math.round(finalPrice * 100),
          currency: isUsd ? 'USD' : 'GHS',
          ref: data.reference,
          callback: async (response) => {
            try {
              await billingApi.verifyPayment({ gateway: 'PAYSTACK', reference: response.reference });
              toast.success(`${plan.name} plan activated!`);
              onSuccess();
            } catch {
              toast.error('Could not verify payment — contact support if charged');
            } finally { setLoading(false); }
          },
          onClose: () => { setLoading(false); },
        }).openIframe();
      } else if (data.paymentUrl) {
        // Fallback: redirect if Paystack Inline not available
        window.location.href = data.paymentUrl;
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Checkout failed';
      toast.error(msg);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Subscribe to {plan.name}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Billing cycle */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Billing Cycle</p>
            <div className="grid grid-cols-2 gap-2">
              {(['MONTHLY', 'YEARLY'] as const).map((c) => {
                const price = c === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
                return (
                  <button key={c} onClick={() => setCycle(c)}
                    className={cn('p-3 rounded-xl border-2 text-left transition-all text-sm',
                      cycle === c ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300')}>
                    <div className="font-semibold text-gray-900">{c === 'MONTHLY' ? 'Monthly' : 'Yearly'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{fmtPrice(price)}{c === 'MONTHLY' ? '/mo' : '/yr'}</div>
                    {c === 'YEARLY' && plan.monthlyPrice > 0 && (
                      <div className="text-[10px] font-semibold text-teal-600 mt-1">
                        Save {fmtPrice((plan.monthlyPrice * 12) - plan.yearlyPrice)}/yr
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment method — Paystack (card + MoMo) */}
          <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center flex-shrink-0">
              <CreditCard size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-teal-900">Paystack — Cards &amp; Mobile Money</p>
              <p className="text-xs text-teal-700">Visa, Mastercard, MTN MoMo, Vodafone Cash &amp; more</p>
            </div>
          </div>

          {/* Billing email */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Billing Email</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="billing@yourcompany.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>

          {/* Promo code */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Promo Code <span className="text-gray-400 font-normal">(optional)</span></p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={promoCode} onChange={(e) => { setPromoCode(e.target.value); setPromoPreview(null); setPromoError(''); }}
                  placeholder="PROMO2026"
                  className="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <button onClick={() => { void handleCheckPromo(); }} disabled={!promoCode.trim() || checkingPromo}
                className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 disabled:opacity-50 transition-colors">
                {checkingPromo ? '…' : 'Apply'}
              </button>
            </div>
            {promoPreview && (
              <p className="text-xs text-teal-600 flex items-center gap-1 mt-1.5">
                <Check size={11} />
                {promoPreview.discountType === 'PERCENTAGE' ? `${promoPreview.discountValue}% off` : `${fmtPrice(discount)} off`} applied
              </p>
            )}
            {promoError && <p className="text-xs text-red-500 mt-1.5">{promoError}</p>}
          </div>

          {/* Price summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>{plan.name} ({cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'})</span>
              <span>{fmtPrice(basePrice)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-teal-600">
                <span>Promo discount</span>
                <span>-{fmtPrice(discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span>
              <span>{fmtPrice(finalPrice)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button onClick={() => { void handleCheckout(); }} disabled={loading}
            className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
            {loading ? (
              <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Processing…</>
            ) : (
              <>Pay {fmtPrice(finalPrice)} securely</>
            )}
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            Secured by Paystack · Cards &amp; Mobile Money accepted
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── CreditPacks ─────────────────────────────────────────────────────────────

interface CreditPack {
  slug: string; credits: number; amount: number;
  label: string; description: string;
}

function CreditPacksSection({ billingEmail, onPurchased }: {
  billingEmail: string;
  onPurchased: (newBalance: number) => void;
}) {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [buying, setBuying] = useState<string | null>(null);
  const paystackScriptRef = useRef(false);

  useEffect(() => {
    void Promise.all([
      billingApi.getCreditPacks().then((r) => setPacks((r.data as CreditPack[]) ?? [])),
      billingApi.getAiCredits().then((r) => setBalance((r.data as { credits: number }).credits ?? 0)),
    ]);

    // Load Paystack Inline JS once
    if (!paystackScriptRef.current && typeof window !== 'undefined') {
      paystackScriptRef.current = true;
      if (!document.getElementById('paystack-inline')) {
        const s = document.createElement('script');
        s.id = 'paystack-inline';
        s.src = 'https://js.paystack.co/v1/inline.js';
        s.async = true;
        document.head.appendChild(s);
      }
    }
  }, []);

  const handleBuy = async (pack: CreditPack) => {
    if (!billingEmail) { toast.error('Set a billing email first'); return; }
    setBuying(pack.slug);
    try {
      const res = await billingApi.initializeCreditPurchase(pack.slug, billingEmail);
      const { reference, accessCode } = res.data as { reference: string; accessCode: string };

      const paystackKey = process.env['NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY'] ?? '';
      if (!paystackKey || !window.PaystackPop) {
        toast.error('Payment system unavailable');
        setBuying(null);
        return;
      }

      window.PaystackPop.setup({
        key: paystackKey,
        email: billingEmail,
        amount: Math.round(pack.amount * 100),
        currency: 'USD',
        ref: reference,
        metadata: { custom_fields: [{ display_name: 'Pack', variable_name: 'pack', value: pack.label }] },
        callback: async (response) => {
          try {
            const verify = await billingApi.verifyCreditPurchase(response.reference);
            const result = verify.data as { success: boolean; credits: number; newBalance: number };
            if (result.success) {
              setBalance(result.newBalance);
              onPurchased(result.newBalance);
              toast.success(`${pack.label} added! New balance: ${result.newBalance} credits`);
            }
          } catch {
            toast.error('Could not verify payment — contact support');
          } finally { setBuying(null); }
        },
        onClose: () => { setBuying(null); },
      }).openIframe();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to initialize payment';
      toast.error(msg);
      setBuying(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Bot size={16} className="text-teal-600" />AI Credits
        </h2>
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-500" />
          <span className="text-sm font-bold text-gray-900">{balance.toLocaleString()}</span>
          <span className="text-xs text-gray-400">credits remaining</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">Each VerzAI reply costs 1 credit. Credits never expire.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {packs.map((pack) => (
          <div key={pack.slug}
            className={cn('relative border-2 rounded-xl p-4 flex flex-col gap-2 transition-all',
              pack.slug === 'growth-600'
                ? 'border-teal-500 bg-teal-50'
                : 'border-gray-200 hover:border-teal-300')}>
            {pack.slug === 'growth-600' && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 bg-teal-600 text-white rounded-full whitespace-nowrap">
                Most Popular
              </span>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-gray-900">${pack.amount}</span>
              <span className="text-xs text-gray-400">USD</span>
            </div>
            <p className="text-sm font-semibold text-gray-900">{pack.label}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{pack.description}</p>
            <button
              onClick={() => { void handleBuy(pack); }}
              disabled={buying === pack.slug}
              className={cn(
                'mt-auto py-2 px-4 rounded-lg text-sm font-semibold transition-colors',
                pack.slug === 'growth-600'
                  ? 'bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60'
                  : 'bg-gray-100 text-gray-800 hover:bg-teal-600 hover:text-white disabled:opacity-60',
              )}>
              {buying === pack.slug ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="animate-spin h-3 w-3 border-2 border-current/30 border-t-current rounded-full" />
                  Processing…
                </span>
              ) : 'Buy Now'}
            </button>
          </div>
        ))}
      </div>
      {balance <= 20 && balance > 0 && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center gap-2">
          <AlertCircle size={14} className="flex-shrink-0" />
          Only {balance} credits left. Top up to keep VerzAI running.
        </div>
      )}
      {balance === 0 && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={14} className="flex-shrink-0" />
          No credits — VerzAI is paused. Purchase credits to resume auto-replies.
        </div>
      )}
    </div>
  );
}

// ─── ProPlanCard ─────────────────────────────────────────────────────────────

function ProPlanCard({ plan, isCurrent, onSelect }: {
  plan: Plan; isCurrent: boolean; onSelect: () => void;
}) {
  return (
    <div className={cn(
      'relative rounded-2xl border-2 p-6 flex flex-col md:flex-row gap-6 items-start md:items-center transition-all',
      isCurrent ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500 ring-offset-2' : 'border-teal-200 bg-white hover:border-teal-300',
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider bg-teal-100 text-teal-700">
            {plan.name}
          </span>
          {plan.trialDays > 0 && !isCurrent && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              {plan.trialDays}-day free trial
            </span>
          )}
          {isCurrent && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-600 text-white">
              Current Plan
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-3xl font-bold text-gray-900">GH₵{plan.monthlyPrice}</span>
          <span className="text-sm text-gray-400">/month</span>
          <span className="text-sm text-gray-400">·</span>
          <span className="text-sm text-gray-500">~$12 USD</span>
        </div>
        {plan.description && <p className="text-sm text-gray-500 mb-4">{plan.description}</p>}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {(plan.features as string[]).map((f) => (
            <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
              <CheckCircle2 size={12} className="text-teal-500 flex-shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex-shrink-0 w-full md:w-auto">
        {isCurrent ? (
          <div className="py-2.5 px-6 text-center text-sm font-semibold text-teal-700 bg-teal-100 rounded-xl whitespace-nowrap">
            Active
          </div>
        ) : (
          <button onClick={onSelect}
            className="w-full md:w-auto py-2.5 px-6 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition-colors whitespace-nowrap">
            Upgrade to Pro
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingEmail, setBillingEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const [aiCredits, setAiCredits] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, usageRes, invoicesRes, plansRes] = await Promise.all([
        billingApi.getStatus(),
        billingApi.getUsage(),
        billingApi.getInvoices(),
        billingApi.getPlans(),
      ]);
      const s = statusRes.data as BillingStatus;
      setStatus(s);
      setBillingEmail(s.billingEmail ?? '');
      setUsageData(usageRes.data as UsageResponse);
      setInvoices((invoicesRes.data as Invoice[]) ?? []);
      setPlans((plansRes.data as Plan[]) ?? []);
    } catch {
      toast.error('Failed to load billing data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Load Paystack Inline script
    if (!document.getElementById('paystack-inline')) {
      const s = document.createElement('script');
      s.id = 'paystack-inline';
      s.src = 'https://js.paystack.co/v1/inline.js';
      s.async = true;
      document.head.appendChild(s);
    }

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const invoiceId = params.get('invoice');
    const creditsStatus = params.get('credits');
    const packSlug = params.get('pack');

    if (creditsStatus === 'success' && packSlug) {
      window.history.replaceState({}, '', '/billing');
      toast.success('Credits purchased! Balance updated.');
    } else if (paymentStatus === 'success' && invoiceId) {
      window.history.replaceState({}, '', '/billing');
      toast.success('Payment received! Your subscription is being activated.');
    } else if (paymentStatus === 'cancelled') {
      window.history.replaceState({}, '', '/billing');
      toast('Payment cancelled.');
    }
  }, []);

  const handleSaveEmail = async () => {
    if (!billingEmail.trim()) return;
    setSavingEmail(true);
    try {
      await billingApi.updateBillingEmail(billingEmail.trim());
      toast.success('Billing email updated');
    } catch { toast.error('Failed to update email'); }
    finally { setSavingEmail(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!status || !usageData) return null;

  const sub = status.subscription;
  const currentPlan = sub.plan;
  const currentSlug = currentPlan.slug;
  const { usage, limits } = usageData;

  // Show the pro plan (or whichever single public plan exists besides free)
  const proPlan = plans.find((p) => p.slug === 'pro') ?? plans.find((p) => p.slug !== 'free') ?? null;
  const periodLabel = new Date(usage.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function formatPrice(plan: Plan) {
    if (plan.monthlyPrice === 0) return 'Free';
    if (plan.currency === 'GHS') return `GH₵${plan.monthlyPrice}/mo`;
    return `$${plan.monthlyPrice}/mo`;
  }

  return (
    <>
      {checkoutPlan && (
        <CheckoutModal
          plan={checkoutPlan}
          initialEmail={billingEmail}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={() => { setCheckoutPlan(null); void load(); }}
        />
      )}

      <div className="flex flex-col h-full bg-gray-50 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Billing & Plans</h1>
              <p className="text-sm text-gray-500">Manage your subscription, usage, and invoices</p>
            </div>
            <button onClick={() => { void load(); }}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-w-4xl mx-auto w-full">
          {/* Subscription banner */}
          <div className={cn('rounded-2xl border-2 p-5',
            currentSlug === 'pro' ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-white')}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <CreditCard size={22} className="text-teal-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="font-bold text-gray-900 text-lg">{currentPlan.name} Plan</h2>
                    <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', STATUS_STYLE[sub.status] ?? 'bg-gray-100 text-gray-500')}>
                      {sub.status.replace('_', ' ')}
                    </span>
                    {sub.cancelAtPeriodEnd && (
                      <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full font-medium">Cancels at period end</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 space-x-3">
                    {currentPlan.monthlyPrice === 0 && <span>Free forever</span>}
                    {currentPlan.monthlyPrice > 0 && <span>{formatPrice(currentPlan)}</span>}
                    {sub.status === 'TRIAL' && sub.trialEndsAt && (
                      <span className="text-blue-600 font-medium">
                        Trial ends {new Date(sub.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    {sub.status === 'ACTIVE' && currentPlan.monthlyPrice > 0 && (
                      <span>
                        Renews {new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {currentPlan.monthlyPrice > 0 && (
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">{formatPrice(currentPlan)}</p>
                  <p className="text-xs text-gray-400">per {sub.cycle === 'YEARLY' ? 'year' : 'month'}</p>
                </div>
              )}
            </div>

            {sub.status === 'TRIAL' && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex items-center gap-2">
                <AlertCircle size={14} className="flex-shrink-0" />
                Your trial expires soon. Subscribe to continue without interruption.
              </div>
            )}
            {sub.status === 'PAST_DUE' && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
                <AlertCircle size={14} className="flex-shrink-0" />
                Payment failed. Please renew your subscription to restore full access.
              </div>
            )}
          </div>

          {/* Pro plan upgrade card */}
          {proPlan && (
            <div>
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap size={16} className="text-teal-600" />Your Plan
              </h2>
              <ProPlanCard
                plan={proPlan}
                isCurrent={currentSlug === proPlan.slug}
                onSelect={() => setCheckoutPlan(proPlan)}
              />
            </div>
          )}

          {/* Usage meters */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 size={16} className="text-teal-600" />Usage — {periodLabel}
              </h2>
              <span className="text-xs text-gray-400">Live counts · resets monthly</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <UsageBar label="Messages Sent"      used={usage.messagesSent}     limit={limits.messagesPerMonth} color="bg-teal-500" />
              <UsageBar label="Total Contacts"     used={usage.totalContacts}    limit={limits.maxContacts}      color="bg-blue-500" />
              <UsageBar label="Active Agents"      used={usage.activeAgents}     limit={limits.maxAgents}        color="bg-purple-500" />
              <UsageBar label="Templates"          used={usage.totalTemplates}   limit={limits.maxTemplates}     color="bg-orange-400" />
              <UsageBar label="Active Channels"    used={usage.activeChannels}   limit={limits.maxChannels}      color="bg-indigo-400" />
              <UsageBar label="Campaigns Sent"     used={usage.campaignsSent}    limit={limits.maxCampaigns}     color="bg-yellow-400" />
              {limits.aiCreditsPerMonth !== 0 && (
                <UsageBar label="AI Credits Used"  used={usage.aiCreditsUsed}    limit={limits.aiCreditsPerMonth} color="bg-pink-500" />
              )}
            </div>
          </div>

          {/* AI Credits */}
          <CreditPacksSection
            billingEmail={billingEmail}
            onPurchased={(newBalance) => setAiCredits(newBalance)}
          />

          {/* Billing email */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Mail size={16} className="text-teal-600" />Billing Email
            </h2>
            <div className="flex items-center gap-3">
              <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="billing@yourcompany.com"
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <button onClick={() => { void handleSaveEmail(); }} disabled={savingEmail || !billingEmail.trim()}
                className="px-5 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 font-medium whitespace-nowrap transition-colors">
                {savingEmail ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Invoices and payment notifications are sent here.</p>
          </div>

          {/* Invoice history */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Download size={15} className="text-teal-600" />
              <h2 className="font-semibold text-gray-900">Invoice History</h2>
            </div>
            {invoices.length === 0 ? (
              <div className="text-center py-10">
                <CreditCard size={32} className="mx-auto mb-2 text-gray-200" />
                <p className="text-sm text-gray-400">No invoices yet</p>
                <p className="text-xs text-gray-300 mt-1">Invoices appear here after your first payment</p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Invoice #', 'Period', 'Amount', 'Status', 'Gateway', 'Date'].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-700 font-medium">{inv.invoiceNumber}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {new Date(inv.billingPeriodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-900">
                            {inv.currency === 'GHS' ? 'GH₵' : '$'}{inv.total.toFixed(2)}
                            {inv.discount > 0 && <span className="text-xs text-teal-600 ml-1">(-{inv.currency === 'GHS' ? 'GH₵' : '$'}{inv.discount.toFixed(2)})</span>}
                            <span className="text-xs font-normal text-gray-400 ml-1">{inv.currency}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium',
                              inv.status === 'PAID'         ? 'bg-teal-100 text-teal-700' :
                              inv.status === 'OPEN'         ? 'bg-yellow-100 text-yellow-700' :
                              inv.status === 'VOID'         ? 'bg-gray-100 text-gray-500' :
                              inv.status === 'UNCOLLECTIBLE' ? 'bg-red-100 text-red-600' :
                              'bg-blue-100 text-blue-600')}>
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {inv.gateway ? GATEWAY_INFO[inv.gateway]?.label ?? inv.gateway : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {inv.paidAt
                              ? new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile invoice cards */}
                <div className="md:hidden divide-y divide-gray-100">
                  {invoices.map((inv) => {
                    const currSym = inv.currency === 'GHS' ? 'GH₵' : '$';
                    const statusCls =
                      inv.status === 'PAID'          ? 'bg-teal-100 text-teal-700' :
                      inv.status === 'OPEN'          ? 'bg-yellow-100 text-yellow-700' :
                      inv.status === 'VOID'          ? 'bg-gray-100 text-gray-500' :
                      inv.status === 'UNCOLLECTIBLE' ? 'bg-red-100 text-red-600' :
                      'bg-blue-100 text-blue-600';
                    const dateStr = inv.paidAt
                      ? new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return (
                      <div key={inv.id} className="px-4 py-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-gray-500 truncate">{inv.invoiceNumber}</p>
                            <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5">
                              {currSym}{inv.total.toFixed(2)}
                              <span className="text-xs font-normal text-gray-400 ml-1">{inv.currency}</span>
                            </p>
                            {inv.discount > 0 && (
                              <p className="text-xs text-teal-600">Discount: -{currSym}{inv.discount.toFixed(2)}</p>
                            )}
                          </div>
                          <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0', statusCls)}>
                            {inv.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>{new Date(inv.billingPeriodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                          <span className="flex items-center gap-1">
                            {inv.gateway ? GATEWAY_INFO[inv.gateway]?.label ?? inv.gateway : null}
                            {inv.gateway && <span className="text-gray-300">·</span>}
                            {dateStr}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Cancel */}
          {sub.status === 'ACTIVE' && currentSlug !== 'free' && (
            <div className="bg-white rounded-2xl border border-red-100 p-5">
              <h2 className="font-semibold text-red-700 mb-1 flex items-center gap-2">
                <Users size={15} />Subscription Management
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                Cancelling will keep your plan active until the end of the current billing period, then revert to Free.
              </p>
              <button
                onClick={async () => {
                  if (!confirm('Cancel subscription at period end?')) return;
                  try {
                    await billingApi.cancelSubscription(false);
                    toast.success('Subscription will cancel at period end');
                    void load();
                  } catch { toast.error('Failed to cancel subscription'); }
                }}
                className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors font-medium">
                Cancel Subscription
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
