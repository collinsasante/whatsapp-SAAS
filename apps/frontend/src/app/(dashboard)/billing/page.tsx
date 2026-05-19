'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, BarChart3, Check, CheckCircle2,
  CreditCard, Download, Mail, RefreshCw, Tag, Users, X, Zap,
} from 'lucide-react';
import { billingApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

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

function CheckoutModal({ plan, onClose, onSuccess }: {
  plan: Plan; onClose: () => void; onSuccess: () => void;
}) {
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [gateway, setGateway] = useState<'STRIPE' | 'PAYSTACK' | 'FLUTTERWAVE'>('PAYSTACK');
  const [email, setEmail] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);
  const [promoError, setPromoError] = useState('');
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [loading, setLoading] = useState(false);

  // For GHS plan: Stripe charges USD equivalent, local gateways charge GHS
  const isGhs = plan.currency === 'GHS';
  const isStripe = gateway === 'STRIPE';

  function getDisplayPrice(baseGhs: number): string {
    if (isStripe && isGhs) {
      const usd = Math.round((baseGhs / 150) * 12 * 100) / 100;
      return `$${usd.toFixed(2)} USD`;
    }
    return `GH₵${baseGhs.toFixed(2)}`;
  }

  const basePrice = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
  const ghsDiscount = promoPreview ? (cycle === 'YEARLY' ? promoPreview.yearlyDiscount : promoPreview.monthlyDiscount) : 0;
  const finalGhs = Math.max(0, basePrice - ghsDiscount);

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
        gateway,
        billingEmail: email.trim(),
        promoCode: promoPreview?.code,
      });
      const data = res.data as { paymentUrl: string | null; free: boolean };
      if (data.free) {
        toast.success(`${plan.name} plan activated!`);
        onSuccess();
      } else if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Checkout failed';
      toast.error(msg);
    } finally { setLoading(false); }
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
                const ghsPrice = c === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
                return (
                  <button key={c} onClick={() => setCycle(c)}
                    className={cn('p-3 rounded-xl border-2 text-left transition-all text-sm',
                      cycle === c ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300')}>
                    <div className="font-semibold text-gray-900">
                      {c === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {getDisplayPrice(ghsPrice)}{c === 'MONTHLY' ? '/mo' : '/yr'}
                    </div>
                    {c === 'YEARLY' && plan.monthlyPrice > 0 && (
                      <div className="text-[10px] font-semibold text-teal-600 mt-1">
                        Save {isStripe && isGhs ? '$' : 'GH₵'}{((plan.monthlyPrice * 12) - plan.yearlyPrice).toFixed(0)}/yr
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment gateway */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment Method</p>
            <div className="grid grid-cols-3 gap-2">
              {(['PAYSTACK', 'FLUTTERWAVE', 'STRIPE'] as const).map((gw) => (
                <button key={gw} onClick={() => setGateway(gw)}
                  className={cn('p-2.5 rounded-xl border-2 text-center transition-all',
                    gateway === gw ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300')}>
                  <div className={cn('w-4 h-4 rounded-full mx-auto mb-1', GATEWAY_INFO[gw].color)} />
                  <div className="text-[10px] font-semibold text-gray-700">{GATEWAY_INFO[gw].label}</div>
                  {gw === 'STRIPE' && isGhs && (
                    <div className="text-[9px] text-gray-400 mt-0.5">USD</div>
                  )}
                </button>
              ))}
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Promo Code</p>
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
                {promoPreview.discountType === 'PERCENTAGE'
                  ? `${promoPreview.discountValue}% off applied`
                  : `${getDisplayPrice(ghsDiscount)} off applied`}
              </p>
            )}
            {promoError && <p className="text-xs text-red-500 mt-1.5">{promoError}</p>}
          </div>

          {/* Price summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>{plan.name} ({cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'})</span>
              <span>{getDisplayPrice(basePrice)}</span>
            </div>
            {ghsDiscount > 0 && (
              <div className="flex justify-between text-teal-600">
                <span>Promo discount</span>
                <span>-{getDisplayPrice(ghsDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span>
              <span>{getDisplayPrice(finalGhs)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button onClick={() => { void handleCheckout(); }} disabled={loading}
            className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
            {loading ? (
              <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Processing…</>
            ) : (
              <>Pay {getDisplayPrice(finalGhs)} via {GATEWAY_INFO[gateway].label}</>
            )}
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            Subscription activates after payment is verified by our server.
          </p>
        </div>
      </div>
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
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const invoiceId = params.get('invoice');
    if (paymentStatus === 'success' && invoiceId) {
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
              <div className="overflow-x-auto">
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
