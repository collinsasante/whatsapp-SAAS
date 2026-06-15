'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, BarChart3, Bot, Check, CheckCircle2,
  CreditCard, Copy, Download, Mail, RefreshCw, Sparkles, Users, X, Zap,
} from 'lucide-react';
import { billingApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn, getApiError } from '@/lib/utils';
import { PaymentSummary } from '@/components/ui/payment';
import { showConfirm } from '@/store/confirm.store';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  createdAt: string;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
}

interface PaymentDetails {
  mobileMoney: { network: string; number: string; name: string }[];
  bank: { bankName: string; accountNumber: string; accountName: string; branch: string };
}

interface CreditPack {
  slug: string; credits: number; amount: number;
  label: string; description: string; currency: string;
}

// ─── Currency helpers ─────────────────────────────────────────────────────────

const isGhana = typeof window !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Accra'
  : false;
const GHS_RATE = 12.5;

function currSymFor(currency?: string) {
  return currency === 'GHS' || (isGhana && !currency) ? '₵' : '$';
}

function formatUsd(usd: number): string {
  if (isGhana) return `₵${Math.round(usd * GHS_RATE)}`;
  return `$${usd}`;
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

// ─── PaymentDetailsCard ───────────────────────────────────────────────────────

function PaymentDetailsCard({ details }: { details: PaymentDetails }) {
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  return (
    <div className="space-y-4">
      {details.mobileMoney.map((m) => (
        <div key={m.network} className="p-4 rounded-xl bg-yellow-50 border border-yellow-200">
          <p className="text-xs font-bold text-yellow-800 uppercase tracking-wide mb-3">{m.network}</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-yellow-700">Number</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-sm text-yellow-900">{m.number}</span>
                <button onClick={() => copy(m.number)} className="text-yellow-600 hover:text-yellow-800">
                  <Copy size={12} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-yellow-700">Name</span>
              <span className="font-semibold text-sm text-yellow-900">{m.name}</span>
            </div>
          </div>
        </div>
      ))}

      <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
        <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-3">Bank Transfer</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700">Bank</span>
            <span className="font-semibold text-sm text-blue-900">{details.bank.bankName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700">Account Number</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-sm text-blue-900">{details.bank.accountNumber}</span>
              <button onClick={() => copy(details.bank.accountNumber)} className="text-blue-600 hover:text-blue-800">
                <Copy size={12} />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700">Account Name</span>
            <span className="font-semibold text-sm text-blue-900">{details.bank.accountName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700">Branch</span>
            <span className="font-semibold text-sm text-blue-900">{details.bank.branch}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PaymentModal ────────────────────────────────────────────────────────────

function PaymentModal({ title, amount, currency, reference, paymentDetails, onClose }: {
  title: string;
  amount: number;
  currency: string;
  reference: string;
  paymentDetails: PaymentDetails;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const currSym = currSymFor(currency);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await billingApi.notifyPaymentConfirmed(reference);
    } catch {
      // non-fatal — don't block the user
    } finally {
      setConfirming(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Amount + reference summary */}
          <PaymentSummary
            title="Payment Summary"
            paymentMethod={{ icon: <CreditCard size={16} className="text-teal-600" />, name: "Manual Transfer" }}
            items={[
              {
                label: "Reference",
                value: (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{reference}</span>
                    <button onClick={() => copy(reference)} className="text-teal-600 hover:text-teal-800"><Copy size={12} /></button>
                  </div>
                ),
              },
              { label: "Currency", value: currency },
            ]}
            total={{ label: "Amount Due", value: `${currSym}${amount}` }}
            className="border-gray-200"
          />

          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            You <strong>must</strong> include the reference above when making your payment.
          </p>

          {/* Payment details */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Payment Details</p>
            <PaymentDetailsCard details={paymentDetails} />
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            After payment, your account will be upgraded within 24 hours once verified.
          </div>
        </div>

        <div className="px-5 pb-5 flex-shrink-0 space-y-2">
          <button onClick={() => { void handleConfirm(); }} disabled={confirming}
            className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors text-sm flex items-center justify-center gap-2">
            {confirming
              ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Confirming…</>
              : <><Check size={15} /> I understand, I&apos;ll pay now</>}
          </button>
          <button onClick={onClose}
            className="w-full py-3 bg-white rounded-xl border border-gray-100 overflow-hidden text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CheckoutModal ───────────────────────────────────────────────────────────

type PayMethod = 'momo' | 'manual';
type MomoStep = 'form' | 'pending' | 'success' | 'failed';

function CheckoutModal({ plan, initialEmail, onClose, onGenerated, onMomoPaid }: {
  plan: Plan;
  initialEmail?: string;
  onClose: () => void;
  onGenerated: (ref: string, amount: number, currency: string, details: PaymentDetails) => void;
  onMomoPaid: () => void;
}) {
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [loading, setLoading] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('momo');

  // MoMo-specific state
  const [momoPhone, setMomoPhone] = useState('');
  const [momoStep, setMomoStep] = useState<MomoStep>('form');
  const [momoRef, setMomoRef] = useState('');
  const [momoAmount, setMomoAmount] = useState(0);
  const [momoCurrency, setMomoCurrency] = useState('');
  const [momoFailReason, setMomoFailReason] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currSym = isGhana ? '₵' : '$';
  const usdAmount = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
  const displayAmount = isGhana ? Math.round(usdAmount * GHS_RATE) : usdAmount;

  // Poll for MoMo status every 3s
  useEffect(() => {
    if (momoStep !== 'pending' || !momoRef) return;
    let attempts = 0;
    const maxAttempts = 100; // ~5 minutes
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollRef.current!);
        setMomoStep('failed');
        setMomoFailReason('Payment request timed out. Please try again.');
        return;
      }
      try {
        const res = await billingApi.getMomoStatus(momoRef);
        const data = res.data as { status: string; reason?: string };
        if (data.status === 'SUCCEEDED') {
          clearInterval(pollRef.current!);
          setMomoStep('success');
        } else if (data.status === 'FAILED') {
          clearInterval(pollRef.current!);
          setMomoStep('failed');
          setMomoFailReason(data.reason ?? 'Payment declined. Please try again.');
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [momoStep, momoRef]);

  const handleMomoRequest = async () => {
    if (!momoPhone.trim()) { toast.error('Enter your MoMo phone number'); return; }
    setLoading(true);
    try {
      const res = await billingApi.initiateMomoCheckout({
        planSlug: plan.slug,
        cycle,
        momoPhone: momoPhone.trim(),
        billingEmail: email.trim() || undefined,
      });
      const data = res.data as { free?: boolean; referenceId?: string; amount?: number; currency?: string };
      if (data.free) {
        toast.success(`${plan.name} plan activated!`);
        onClose();
        return;
      }
      if (data.referenceId) {
        setMomoRef(data.referenceId);
        setMomoAmount(data.amount ?? displayAmount);
        setMomoCurrency(data.currency ?? 'EUR');
        setMomoStep('pending');
      }
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Failed to send MoMo request'));
    } finally { setLoading(false); }
  };

  const handleManualGenerate = async () => {
    setLoading(true);
    try {
      const res = await billingApi.initiateCheckout({ planSlug: plan.slug, cycle, billingEmail: email.trim() || undefined });
      const data = res.data as { free?: boolean; reference?: string; amount?: number; currency?: string; paymentDetails?: PaymentDetails };
      if (data.free) { toast.success(`${plan.name} plan activated!`); onClose(); return; }
      if (data.reference && data.paymentDetails) {
        onGenerated(data.reference, data.amount ?? displayAmount, data.currency ?? 'USD', data.paymentDetails);
      }
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Failed to generate payment reference'));
    } finally { setLoading(false); }
  };

  const handleSuccessClose = () => { onMomoPaid(); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Subscribe to {plan.name}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* MoMo success state */}
        {momoStep === 'success' && (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center">
              <CheckCircle2 size={32} className="text-teal-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">Payment Confirmed!</p>
              <p className="text-sm text-gray-500 mt-1">Your {plan.name} plan is now active.</p>
            </div>
            <button onClick={handleSuccessClose}
              className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors text-sm">
              Continue
            </button>
          </div>
        )}

        {/* MoMo failed state */}
        {momoStep === 'failed' && (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">Payment Failed</p>
              <p className="text-sm text-gray-500 mt-1">{momoFailReason}</p>
            </div>
            <button onClick={() => setMomoStep('form')}
              className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors text-sm">
              Try Again
            </button>
          </div>
        )}

        {/* MoMo pending — waiting for USSD approval */}
        {momoStep === 'pending' && (
          <div className="p-8 flex flex-col items-center gap-5 text-center">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-yellow-200" />
              <div className="absolute inset-0 rounded-full border-4 border-t-yellow-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">📱</div>
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">Check your phone</p>
              <p className="text-sm text-gray-500 mt-1">
                A payment prompt has been sent to <span className="font-semibold text-gray-700">{momoPhone}</span>.<br />
                Enter your MoMo PIN to approve {momoCurrency === 'GHS' ? '₵' : ''}{momoAmount} {momoCurrency}.
              </p>
            </div>
            <div className="w-full bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-800 text-left space-y-1">
              <p className="font-semibold">What to do:</p>
              <p>1. Check your phone for an MTN MoMo prompt</p>
              <p>2. Enter your MoMo PIN to approve</p>
              <p>3. This screen will update automatically</p>
            </div>
            <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('form'); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline">
              Cancel and go back
            </button>
          </div>
        )}

        {/* Main form */}
        {momoStep === 'form' && (
          <>
            <div className="p-5 space-y-5">
              {/* Payment method tabs */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPayMethod('momo')}
                    className={cn('p-3 rounded-xl border-2 text-left transition-all',
                      payMethod === 'momo' ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-gray-300')}>
                    <div className="text-sm font-semibold text-gray-900">📱 MTN MoMo</div>
                    <div className="text-xs text-gray-500 mt-0.5">Instant USSD approval</div>
                  </button>
                  <button onClick={() => setPayMethod('manual')}
                    className={cn('p-3 rounded-xl border-2 text-left transition-all',
                      payMethod === 'manual' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300')}>
                    <div className="text-sm font-semibold text-gray-900">🏦 Manual Transfer</div>
                    <div className="text-xs text-gray-500 mt-0.5">Bank or MoMo manual</div>
                  </button>
                </div>
              </div>

              {/* Billing cycle */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Billing Cycle</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['MONTHLY', 'YEARLY'] as const).map((c) => {
                    const usdPrice = c === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
                    const price = isGhana ? Math.round(usdPrice * GHS_RATE) : usdPrice;
                    return (
                      <button key={c} onClick={() => setCycle(c)}
                        className={cn('p-3 rounded-xl border-2 text-left transition-all text-sm',
                          cycle === c ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300')}>
                        <div className="font-semibold text-gray-900">{c === 'MONTHLY' ? 'Monthly' : 'Yearly'}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{currSym}{price}{c === 'MONTHLY' ? '/mo' : '/yr'}</div>
                        {c === 'YEARLY' && plan.monthlyPrice > 0 && (
                          <div className="text-[10px] font-semibold text-teal-600 mt-1">
                            Save {currSym}{isGhana ? Math.round((plan.monthlyPrice * 12 - plan.yearlyPrice) * GHS_RATE) : plan.monthlyPrice * 12 - plan.yearlyPrice}/yr
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MoMo phone input */}
              {payMethod === 'momo' && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    MTN MoMo Number
                  </p>
                  <input
                    type="tel"
                    value={momoPhone}
                    onChange={(e) => setMomoPhone(e.target.value)}
                    placeholder="e.g. 0551234567 or +233551234567"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    You will receive a USSD prompt to approve the payment.
                  </p>
                </div>
              )}

              {/* Email */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Billing Email <span className="text-gray-400 font-normal">(optional)</span>
                </p>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="billing@yourcompany.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 text-sm">
                <div className="flex justify-between font-bold text-gray-900">
                  <span>{plan.name} ({cycle === 'MONTHLY' ? 'Monthly' : 'Yearly'})</span>
                  <span>{currSym}{displayAmount}</span>
                </div>
                {isGhana && <p className="text-xs text-gray-400 mt-1">Rate: 1 USD = {GHS_RATE} GHS</p>}
              </div>
            </div>

            <div className="px-5 pb-5">
              {payMethod === 'momo' ? (
                <button onClick={() => { void handleMomoRequest(); }} disabled={loading || !momoPhone.trim()}
                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-xl disabled:opacity-60 transition-colors flex items-center justify-center gap-2 text-sm">
                  {loading
                    ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Sending request…</>
                    : <>📱 Pay with MTN MoMo</>}
                </button>
              ) : (
                <button onClick={() => { void handleManualGenerate(); }} disabled={loading}
                  className="w-full py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 text-sm">
                  {loading
                    ? <><span className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />Generating…</>
                    : <>Generate Payment Reference</>}
                </button>
              )}
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
  const [buying, setBuying] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    reference: string; amount: number; currency: string; details: PaymentDetails;
  } | null>(null);

  useEffect(() => {
    void Promise.all([
      billingApi.getCreditPacks().then((r) => setPacks((r.data as CreditPack[]) ?? [])),
      billingApi.getAiCredits().then((r) => setBalance((r.data as { credits: number }).credits ?? 0)),
    ]);
  }, []);

  const handleBuy = async (pack: CreditPack) => {
    setBuying(pack.slug);
    try {
      const res = await billingApi.initializeCreditPurchase(pack.slug);
      const data = res.data as { reference: string; amount: number; currency: string; paymentDetails: PaymentDetails };
      setPaymentModal({ reference: data.reference, amount: data.amount, currency: data.currency ?? 'USD', details: data.paymentDetails });
    } catch (err: unknown) {
      toast.error(getApiError(err, 'Failed to initialize payment'));
    } finally { setBuying(null); }
  };

  return (
    <>
      {paymentModal && (
        <PaymentModal
          title="Buy AI Credits"
          amount={paymentModal.amount}
          currency={paymentModal.currency}
          reference={paymentModal.reference}
          paymentDetails={paymentModal.details}
          onClose={() => { setPaymentModal(null); onPurchased(balance); }}
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
    </>
  );
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent, currentSlug, onSelect }: {
  plan: Plan; isCurrent: boolean; currentSlug: string; onSelect: () => void;
}) {
  const isFree = plan.monthlyPrice === 0;
  const ORDER: Record<string, number> = { free: 0, starter: 1, pro: 2 };
  const currentOrder = ORDER[currentSlug] ?? 0;
  const planOrder = ORDER[plan.slug] ?? 1;
  const isUpgrade = planOrder > currentOrder;
  const isDowngrade = planOrder < currentOrder;

  const btnLabel = isCurrent ? 'Current Plan' : isUpgrade ? `Upgrade to ${plan.name}` : isDowngrade ? `Switch to ${plan.name}` : `Select ${plan.name}`;

  return (
    <div className={cn(
      'relative rounded-2xl border-2 p-5 flex flex-col gap-4 transition-all',
      isCurrent ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500 ring-offset-1' : 'border-gray-200 bg-white hover:border-teal-300',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{plan.name}</span>
            {isCurrent && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-600 text-white uppercase tracking-wide">
                Current
              </span>
            )}
            {plan.trialDays > 0 && !isCurrent && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {plan.trialDays}-day trial
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-gray-900">{isFree ? 'Free' : formatUsd(plan.monthlyPrice)}</span>
            {!isFree && <span className="text-xs text-gray-400">/month</span>}
          </div>
          {plan.description && <p className="text-xs text-gray-500 mt-1">{plan.description}</p>}
        </div>
      </div>
      {(plan.features as string[]).length > 0 && (
        <ul className="space-y-1">
          {(plan.features as string[]).map((f) => (
            <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
              <Check size={11} className="text-teal-500 flex-shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-2">
        {isCurrent ? (
          <div className="py-2 px-4 text-center text-xs font-semibold text-teal-700 bg-teal-100 rounded-xl">
            Active
          </div>
        ) : (
          <button onClick={onSelect}
            className={cn(
              'w-full py-2 px-4 text-xs font-semibold rounded-xl transition-colors',
              isUpgrade
                ? 'text-white bg-teal-600 hover:bg-teal-700'
                : 'text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200',
            )}>
            {btnLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingEmail, setBillingEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    title: string; reference: string; amount: number; currency: string; details: PaymentDetails;
  } | null>(null);

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

  if (!status || !usageData) return null;

  const sub = status.subscription;
  const currentPlan = sub.plan;
  const currentSlug = currentPlan.slug;
  const publicPlans = plans.filter((p) => p.isActive);
  const { usage, limits } = usageData;

  const periodLabel = new Date(usage.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function formatPrice(plan: Plan) {
    if (plan.monthlyPrice === 0) return 'Free';
    return `${formatUsd(plan.monthlyPrice)}/mo`;
  }

  return (
    <>
      {checkoutPlan && (
        <CheckoutModal
          plan={checkoutPlan}
          initialEmail={billingEmail}
          onClose={() => setCheckoutPlan(null)}
          onGenerated={(ref, amount, currency, details) => {
            setCheckoutPlan(null);
            setPaymentModal({ title: `Upgrade to ${checkoutPlan.name}`, reference: ref, amount, currency, details });
          }}
          onMomoPaid={() => { void load(); }}
        />
      )}

      {paymentModal && (
        <PaymentModal
          title={paymentModal.title}
          amount={paymentModal.amount}
          currency={paymentModal.currency}
          reference={paymentModal.reference}
          paymentDetails={paymentModal.details}
          onClose={() => setPaymentModal(null)}
        />
      )}

      <div className="flex flex-col h-full bg-gray-50 overflow-auto">
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
                Payment is pending verification. Contact support if you&apos;ve already paid.
              </div>
            )}
          </div>

          {/* Available plans */}
          {publicPlans.length > 0 && (
            <div>
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap size={16} className="text-teal-600" />Plans
              </h2>
              <div className={cn(
                'grid gap-4',
                publicPlans.length === 1 ? 'grid-cols-1' : publicPlans.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
              )}>
                {publicPlans.map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isCurrent={currentSlug === plan.slug}
                    currentSlug={currentSlug}
                    onSelect={() => setCheckoutPlan(plan)}
                  />
                ))}
              </div>
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
              <UsageBar label="Messages Sent"   used={usage.messagesSent}   limit={limits.messagesPerMonth} color="bg-teal-500" />
              <UsageBar label="Total Contacts"  used={usage.totalContacts}  limit={limits.maxContacts}      color="bg-blue-500" />
              <UsageBar label="Active Agents"   used={usage.activeAgents}   limit={limits.maxAgents}        color="bg-purple-500" />
              <UsageBar label="Templates"       used={usage.totalTemplates} limit={limits.maxTemplates}     color="bg-orange-400" />
              <UsageBar label="Active Channels" used={usage.activeChannels} limit={limits.maxChannels}      color="bg-indigo-400" />
              <UsageBar label="Campaigns Sent"  used={usage.campaignsSent}  limit={limits.maxCampaigns}     color="bg-yellow-400" />
              {limits.aiCreditsPerMonth !== 0 && (
                <UsageBar label="AI Credits Used" used={usage.aiCreditsUsed} limit={limits.aiCreditsPerMonth} color="bg-pink-500" />
              )}
            </div>
          </div>

          {/* AI Credits */}
          <CreditPacksSection onPurchased={() => { void load(); }} />

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
                            inv.status === 'OPEN' ? 'bg-yellow-100 text-yellow-700' :
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
