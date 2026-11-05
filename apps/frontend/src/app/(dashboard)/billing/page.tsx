'use client';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, BarChart3, Bot, CheckCircle2,
  CreditCard, Download, Mail, Receipt, RefreshCw, Sparkles, Users, X,
} from 'lucide-react';
import { billingApi } from '@/lib/api';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import { cn, getApiError } from '@/lib/utils';
import { PaystackCheckoutButton } from '@/components/billing/GatewayCheckout';
import { useAuthStore } from '@/store/auth.store';
import { isPlausibleEmail } from '@/lib/billing-checkout';
import { showConfirm } from '@/store/confirm.store';

// ─── Types ──────────────────────────────────────────────────────────────────

// What a plan costs is deliberately not part of this type: while subscription sales are off the API sends no price.
interface Plan {
  id: string; slug: string; name: string; description: string | null;
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
  createdAt: string;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
}

interface CreditPack {
  id: string; slug: string; name: string;
  credits: number; bonusCredits: number;
  priceGhs: number | null; priceUsd: number | null;
  isActive: boolean; displayOrder: number;
}

interface CreditTransaction {
  id: string;
  type: 'PURCHASE' | 'BONUS' | 'AI_USAGE' | 'REFUND' | 'ADJUSTMENT';
  credits: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface CreditUsageSummary {
  dailyCreditCap: number | null;
  spentToday: number;
  heldNow: number;
  capWarnPercent: number;
  capState: 'NO_CAP' | 'OK' | 'WARNING' | 'REACHED';
  percentOfCapUsed: number | null;
  capResetsAt: string;
  capTimezone: string;
  currentBalance: number;
  usedThisMonth: number;
  purchasedThisMonth: number;
  aiRequestsThisMonth: number;
  totalPurchased: number;
  totalUsed: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-teal-100 text-teal-700',
  TRIAL:     'bg-blue-100 text-blue-700',
  PAST_DUE:  'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  CANCELED:  'bg-gray-100 text-gray-600',
  EXPIRED:   'bg-gray-100 text-gray-500',
};

// ─── UsageBar ────────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit, color }: { label: string; used: number; limit: number; color: string }) {
  const unlimited = limit < 0;
  // A limit of 0 means the workspace's plan does not include this at all. It is not "0 of 0 used", so it gets no meter and no warning.
  if (limit === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-gray-600">{label}</span>
          <span className="font-semibold text-gray-400">Not included</span>
        </div>
      </div>
    );
  }
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

type CheckoutStep = 'form' | 'pay' | 'success';

// ─── CreditCheckoutModal ──────────────────────────────────────────────────────

function CreditCheckoutModal({ pack, onClose, onPurchased }: {
  pack: CreditPack;
  onClose: () => void;
  onPurchased: () => void;
}) {
  const panelRef = useDialogBehavior<HTMLDivElement>(onClose);
  const userEmail = useAuthStore((st) => st.user?.email);
  // The purchase needs a receipt address. Use the signed-in user's email, and let them change it.
  const [email, setEmail] = useState(userEmail ?? '');
  const emailOk = isPlausibleEmail(email);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<CheckoutStep>('form');
  const [error, setError] = useState<string | null>(null);
  const [paystackAccessCode, setPaystackAccessCode] = useState<string | null>(null);
  const totalCredits = pack.credits + pack.bonusCredits;
  const price = pack.priceGhs;
  const priceLabel = price == null ? 'Not available' : `GH₵${price}`;

  const handleContinue = async () => {
    setError(null);
    if (!emailOk) { setError('Enter a valid email so we can send your receipt.'); return; }
    setLoading(true);
    try {
      const res = await billingApi.initiatePaystackCreditCheckout(pack.slug, email.trim());
      const data = res.data as { accessCode: string };
      setPaystackAccessCode(data.accessCode);
      setStep('pay');
    } catch (err: unknown) {
      const message = getApiError(err, 'Could not start checkout. Please try again.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden focus:outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Buy {pack.name}</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {step === 'success' && (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center">
              <CheckCircle2 size={32} className="text-teal-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">Payment successful</p>
              <p className="text-sm text-gray-500 mt-1">Your credits will be added within a few seconds.</p>
            </div>
            <button onClick={() => { onPurchased(); onClose(); }}
              className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors text-sm">
              Continue
            </button>
          </div>
        )}

        {step === 'pay' && (
          <div className="p-5 space-y-4">
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {paystackAccessCode && (
              <PaystackCheckoutButton
                accessCode={paystackAccessCode}
                onSuccess={() => setStep('success')}
                onError={(msg) => setError(msg)}
              />
            )}
            <button onClick={() => setStep('form')} className="w-full text-xs text-gray-400 hover:text-gray-600 underline">
              Back
            </button>
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment Method</p>
                <div className="p-3 rounded-xl border-2 border-teal-500 bg-teal-50">
                  <div className="text-sm font-semibold text-gray-900">Paystack</div>
                  <div className="text-xs text-gray-500 mt-0.5">Card, Mobile Money, bank. Charged in Ghana cedis (GHS).</div>
                </div>
              </div>
              <div>
                <label htmlFor="credit-billing-email" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Email for your receipt</label>
                <input id="credit-billing-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com" aria-invalid={email.length > 0 && !emailOk}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {email.length > 0 && !emailOk && <p className="text-xs text-red-600 mt-1">Enter a valid email address.</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-4 text-sm flex justify-between font-bold text-gray-900">
                <span>{pack.name}, {totalCredits.toLocaleString()} credits</span><span>{priceLabel}</span>
              </div>
            </div>
            <div className="px-5 pb-5">
              <button onClick={() => { void handleContinue(); }} disabled={loading || price == null || !emailOk}
                className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 text-sm">
                {loading
                  ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Starting checkout...</>
                  : 'Continue to Payment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── CreditPacksSection ───────────────────────────────────────────────────────

function CreditPacksSection({ onPurchased }: { onPurchased: (newBalance: number) => void }) {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [buyingPack, setBuyingPack] = useState<CreditPack | null>(null);

  useEffect(() => {
    void Promise.all([
      billingApi.getCreditPacks().then((r) => setPacks((r.data as CreditPack[]) ?? [])),
      billingApi.getAiCredits().then((r) => setBalance((r.data as { credits: number }).credits ?? 0)),
    ]);
  }, []);

  return (
    <>
      {buyingPack && (
        <CreditCheckoutModal
          pack={buyingPack}
          onClose={() => setBuyingPack(null)}
          onPurchased={() => onPurchased(balance)}
        />
      )}

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
        <p className="text-xs text-gray-400 mb-4">Credits are spent based on actual AI usage per reply, so cost scales with how much VerzAI has to do. Credits never expire.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {packs.map((pack, i) => {
            const isFeatured = i === 1; // second tier ("Growth") highlighted, same visual convention as before
            return (
            <div key={pack.slug}
              className={cn('relative border-2 rounded-xl p-4 flex flex-col gap-2 transition-all',
                isFeatured
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:border-teal-300')}>
              {isFeatured && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 bg-teal-600 text-white rounded-full whitespace-nowrap">
                  Most Popular
                </span>
              )}
              <div className="flex items-baseline gap-1.5 flex-wrap">
                {pack.priceGhs != null && <span className="text-xl font-bold text-gray-900">GH₵{pack.priceGhs}</span>}
                {pack.priceUsd != null && <span className="text-xs text-gray-400">${pack.priceUsd}</span>}
              </div>
              <p className="text-sm font-semibold text-gray-900">{pack.name}</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                {(pack.credits + pack.bonusCredits).toLocaleString()} credits
                {pack.bonusCredits > 0 && <span className="text-teal-600"> (+{pack.bonusCredits.toLocaleString()} bonus)</span>}
              </p>
              <button
                onClick={() => setBuyingPack(pack)}
                className={cn(
                  'mt-auto py-2 px-4 rounded-lg text-sm font-semibold transition-colors',
                  isFeatured
                    ? 'bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60'
                    : 'bg-gray-100 text-gray-800 hover:bg-teal-600 hover:text-white disabled:opacity-60',
                )}>
                Buy Now
              </button>
            </div>
            );
          })}
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
            No credits: VerzAI is paused. Purchase credits to resume auto-replies.
          </div>
        )}
      </div>
    </>
  );
}

// ─── CreditActivitySection ─────────────────────────────────────────────────────

const TXN_STYLE: Record<CreditTransaction['type'], { label: string; color: string }> = {
  PURCHASE:  { label: 'Credit Purchase', color: 'text-teal-600' },
  BONUS:     { label: 'Bonus',           color: 'text-teal-600' },
  AI_USAGE:  { label: 'AI Usage',        color: 'text-gray-500' },
  REFUND:    { label: 'Refund',          color: 'text-teal-600' },
  ADJUSTMENT:{ label: 'Adjustment',      color: 'text-amber-600' },
};

/** Today's AI spend against the daily cap the platform set for this workspace, with when it resets. Only shown when a cap exists. */
function DailyCapStatus({ summary }: { summary: CreditUsageSummary }) {
  if (summary.dailyCreditCap === null) return null;
  const used = summary.spentToday + summary.heldNow;
  const pct = summary.percentOfCapUsed ?? 0;
  const reached = summary.capState === 'REACHED';
  const near = summary.capState === 'WARNING';
  return (
    <div className={cn('mb-5 rounded-xl border p-4', reached ? 'border-red-200 bg-red-50' : near ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50')} role="status">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">Daily AI spend</p>
        <p className="text-sm tabular-nums text-gray-700">{used.toLocaleString()} of {summary.dailyCreditCap.toLocaleString()} credits</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white" aria-hidden="true">
        <div className={cn('h-full rounded-full', reached ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-teal-500')} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-gray-700">
        {reached
          ? 'Verz AI has paused for today because the daily cap was reached. Your team can still reply to every conversation.'
          : near ? `Verz AI has used over ${summary.capWarnPercent}% of today's cap.` : 'Verz AI is within today\'s cap.'}
        {' '}The cap resets {new Date(summary.capResetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ({summary.capTimezone}).
        To change the cap, contact support.
      </p>
    </div>
  );
}

function CreditActivitySection() {
  const [summary, setSummary] = useState<CreditUsageSummary | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      billingApi.getCreditUsageSummary().then((r) => setSummary(r.data as CreditUsageSummary)),
      billingApi.getCreditTransactions(1, 20).then((r) => setTransactions((r.data as { items: CreditTransaction[] }).items ?? [])),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <Receipt size={16} className="text-teal-600" />Usage &amp; Transactions
      </h2>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Current Balance', value: summary.currentBalance },
            { label: 'Used This Month', value: summary.usedThisMonth },
            { label: 'Purchased This Month', value: summary.purchasedThisMonth },
            { label: 'AI Requests This Month', value: summary.aiRequestsThisMonth },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-bold text-gray-900">{s.value.toLocaleString()}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {summary && <DailyCapStatus summary={summary} />}

      {transactions.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No credit activity yet</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {transactions.map((txn) => {
            const style = TXN_STYLE[txn.type];
            const positive = txn.credits > 0;
            return (
              <div key={txn.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', style.color)}>{style.label}</p>
                  <p className="text-xs text-gray-400 truncate">{txn.description}</p>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <p className={cn('text-sm font-semibold', positive ? 'text-teal-600' : 'text-gray-700')}>
                    {positive ? '+' : ''}{txn.credits.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400">{new Date(txn.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingEmail, setBillingEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, usageRes, invoicesRes] = await Promise.all([
        billingApi.getStatus(),
        billingApi.getUsage(),
        billingApi.getInvoices(),
      ]);
      const s = statusRes.data as BillingStatus;
      setStatus(s);
      setBillingEmail(s.billingEmail ?? '');
      setUsageData(usageRes.data as UsageResponse);
      setInvoices((invoicesRes.data as Invoice[]) ?? []);
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load billing data'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSaveEmail = async () => {
    if (!billingEmail.trim()) return;
    setSavingEmail(true);
    try {
      await billingApi.updateBillingEmail(billingEmail.trim());
      toast.success('Billing email updated');
    } catch (err) { toast.error(getApiError(err, 'Failed to update billing email')); }
    finally { setSavingEmail(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!status || !usageData) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <EmptyState title="Billing could not be loaded" compact>
          Your plan and invoices are not affected. Check your connection and try again.
        </EmptyState>
        <Button className="mt-3" onClick={() => { void load(); }}>Try again</Button>
      </div>
    );
  }

  const sub = status.subscription;
  const currentPlan = sub.plan;
  const currentSlug = currentPlan.slug;
  const { usage, limits } = usageData;

  const periodLabel = new Date(usage.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="flex flex-col h-full bg-gray-50 overflow-auto">
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Billing</h1>
              <p className="text-sm text-gray-500">Your plan, usage, AI credits and invoices</p>
            </div>
            <button onClick={() => { void load(); }}
              className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-w-4xl mx-auto w-full">
          {/* Current plan: only for a workspace that still has a paid subscription (name, status and dates; no price, no purchase). */}
          {currentSlug !== 'free' && (
          <div className={cn('rounded-2xl border-2 p-5',
            currentSlug === 'pro' ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-white')}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <CreditCard size={22} className="text-teal-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="font-bold text-gray-900 text-lg">{currentPlan.name} plan</h2>
                    <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', STATUS_STYLE[sub.status] ?? 'bg-gray-100 text-gray-500')}>
                      {sub.status.replace('_', ' ')}
                    </span>
                    {sub.cancelAtPeriodEnd && (
                      <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full font-medium">Cancels at period end</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 space-x-3">
                    {sub.status === 'TRIAL' && sub.trialEndsAt && (
                      <span className="text-blue-600 font-medium">
                        Trial ends {new Date(sub.trialEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    {sub.status === 'ACTIVE' && currentSlug !== 'free' && (
                      <span>
                        Renews {new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {sub.status === 'PAST_DUE' && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
                <AlertCircle size={14} className="flex-shrink-0" />
                Payment is pending verification. Contact support if you&apos;ve already paid.
              </div>
            )}
          </div>
          )}

          {/* Usage meters */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 size={16} className="text-teal-600" />Usage: {periodLabel}
              </h2>
              <span className="text-xs text-gray-400">Live counts · resets monthly</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <UsageBar label="Messages Sent"   used={usage.messagesSent}   limit={limits.messagesPerMonth} color="bg-teal-500" />
              <UsageBar label="Total Contacts"  used={usage.totalContacts}  limit={limits.maxContacts}      color="bg-blue-500" />
              <UsageBar label="Active Agents"   used={usage.activeAgents}   limit={limits.maxAgents}        color="bg-purple-500" />
              <UsageBar label="Templates"       used={usage.totalTemplates} limit={limits.maxTemplates}     color="bg-orange-400" />
              <UsageBar label="Active Channels" used={usage.activeChannels} limit={limits.maxChannels}      color="bg-blue-400" />
              <UsageBar label="Campaigns Sent"  used={usage.campaignsSent}  limit={limits.maxCampaigns}     color="bg-amber-400" />
            </div>
          </div>

          {/* AI Credits */}
          <CreditPacksSection onPurchased={() => { void load(); }} />

          {/* AI Credits usage & transaction history */}
          <CreditActivitySection />

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
            <p className="text-xs text-gray-400 mt-2">Used for invoice records.</p>
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
              </div>
            ) : (
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['Invoice #', 'Period', 'Amount', 'Status', 'Date'].map((h) => (
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
                          {'$'}{inv.total.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium',
                            inv.status === 'PAID' ? 'bg-teal-100 text-teal-700' :
                            inv.status === 'OPEN' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-500')}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(inv.paidAt ?? inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                  if (!await showConfirm('Cancel subscription?', { subtext: 'Your plan stays active until period end, then reverts to Free.', confirmLabel: 'Cancel Plan', danger: true })) return;
                  try {
                    await billingApi.cancelSubscription(false);
                    toast.success('Subscription will cancel at period end');
                    void load();
                  } catch (err) { toast.error(getApiError(err, 'Failed to cancel subscription')); }
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
