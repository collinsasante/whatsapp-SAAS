'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  CreditCard, Zap, Users, MessageSquare, FileText, Layout,
  CheckCircle2, ArrowUpRight, RefreshCw, Mail, Download,
  BarChart3, AlertCircle,
} from 'lucide-react';
import { billingApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface PlanDetails {
  name: string; price: number; messagesPerMonth: number;
  contacts: number; agents: number; channels: number; templates: number;
  features: string[];
}

interface BillingStatus {
  currentPlan: string;
  planDetails: PlanDetails;
  planStartedAt: string | null;
  planExpiresAt: string | null;
  nextRenewal: string;
  billingEmail: string | null;
  plans: Record<string, PlanDetails>;
}

interface Usage {
  cycleStart: string;
  messagesSent: number;
  totalContacts: number;
  totalAgents: number;
  totalTemplates: number;
  totalChannels: number;
  totalCampaigns: number;
  limits: { messagesPerMonth: number; contacts: number; agents: number; channels: number; templates: number };
}

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  period: string;
  paidAt: string | null;
  createdAt: string;
}

const PLAN_COLORS: Record<string, string> = {
  free:       'border-gray-200 bg-white',
  starter:    'border-blue-200 bg-blue-50',
  growth:     'border-teal-200 bg-teal-50',
  enterprise: 'border-purple-200 bg-purple-50',
};

const PLAN_BADGE: Record<string, string> = {
  free:       'bg-gray-100 text-gray-600',
  starter:    'bg-blue-100 text-blue-700',
  growth:     'bg-teal-100 text-teal-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

function UsageBar({ label, used, limit, icon: Icon, color }: {
  label: string; used: number; limit: number; icon: React.ElementType; color: string;
}) {
  const pct = limit < 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const isUnlimited = limit < 0;
  const isOver = pct >= 90 && !isUnlimited;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Icon size={14} className="text-gray-400" />
          {label}
        </div>
        <span className={cn('text-xs font-semibold', isOver ? 'text-red-600' : 'text-gray-500')}>
          {isUnlimited ? (
            <span className="text-teal-600">Unlimited</span>
          ) : (
            <>{used.toLocaleString()} / {limit.toLocaleString()}</>
          )}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', color, isOver && 'bg-red-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {isOver && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle size={11} />Approaching limit — consider upgrading
        </p>
      )}
    </div>
  );
}

function PlanCard({
  planKey, plan, isCurrent, isUpgrade, isDowngrade, upgrading, onSelect,
}: {
  planKey: string; plan: PlanDetails; isCurrent: boolean; isUpgrade: boolean; isDowngrade: boolean;
  upgrading: boolean; onSelect: () => void;
}) {
  const color = PLAN_COLORS[planKey] ?? PLAN_COLORS['free'];
  const badge = PLAN_BADGE[planKey] ?? PLAN_BADGE['free'];
  const isPopular = planKey === 'growth';

  return (
    <div className={cn('relative rounded-2xl border-2 p-5 flex flex-col transition-all', color,
      isCurrent && 'ring-2 ring-offset-2',
      planKey === 'free' && isCurrent && 'ring-gray-400',
      planKey === 'starter' && isCurrent && 'ring-blue-400',
      planKey === 'growth' && isCurrent && 'ring-teal-500',
      planKey === 'enterprise' && isCurrent && 'ring-purple-500')}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
          Most Popular
        </div>
      )}
      <div className="mb-4">
        <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide', badge)}>
          {plan.name}
        </span>
        <div className="mt-3">
          {plan.price < 0 ? (
            <p className="text-2xl font-bold text-gray-900">Custom</p>
          ) : plan.price === 0 ? (
            <p className="text-2xl font-bold text-gray-900">Free</p>
          ) : (
            <p className="text-2xl font-bold text-gray-900">
              ${plan.price}<span className="text-sm font-normal text-gray-400">/mo</span>
            </p>
          )}
        </div>
      </div>

      <ul className="space-y-2 flex-1 mb-5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
            <CheckCircle2 size={13} className="text-teal-500 flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <div className="py-2.5 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl">
          Current Plan
        </div>
      ) : planKey === 'enterprise' ? (
        <button className="py-2.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 transition-colors flex items-center justify-center gap-1.5">
          Contact Sales <ArrowUpRight size={13} />
        </button>
      ) : (
        <button onClick={onSelect} disabled={upgrading}
          className={cn('py-2.5 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60',
            isUpgrade
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
          {upgrading ? 'Processing…' : isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
          {isUpgrade && <ArrowUpRight size={13} />}
        </button>
      )}
    </div>
  );
}

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
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
      setUsage(usageRes.data as Usage);
      setInvoices((invoicesRes.data as Invoice[]) ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleUpgrade = async (planKey: string) => {
    setUpgrading(planKey);
    try {
      await billingApi.upgradePlan(planKey);
      await load();
      toast.success(`Switched to ${status?.plans[planKey]?.name ?? planKey} plan!`);
    } catch { toast.error('Failed to change plan'); }
    finally { setUpgrading(null); }
  };

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

  if (!status || !usage) return null;

  const currentPlanKey = status.currentPlan;
  const planOrder = ['free', 'starter', 'growth', 'enterprise'];
  const currentPlanIdx = planOrder.indexOf(currentPlanKey);

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Billing & Plans</h1>
            <p className="text-sm text-gray-500">Manage your subscription and track usage</p>
          </div>
          <button onClick={() => { void load(); }}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-5xl mx-auto w-full">
        {/* Current plan banner */}
        <div className={cn('rounded-2xl border-2 p-5 flex items-center justify-between', PLAN_COLORS[currentPlanKey] ?? PLAN_COLORS['free'])}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <CreditCard size={22} className="text-teal-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="font-bold text-gray-900 text-lg">{status.planDetails.name} Plan</h2>
                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', PLAN_BADGE[currentPlanKey])}>Active</span>
              </div>
              <p className="text-sm text-gray-500">
                {status.planDetails.price === 0 ? 'Free forever' : status.planDetails.price < 0 ? 'Custom pricing' : `$${status.planDetails.price}/month`}
                {status.nextRenewal && status.planDetails.price > 0 && (
                  <> · Renews {new Date(status.nextRenewal).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>
          {status.planDetails.price > 0 && (
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">${status.planDetails.price}</p>
              <p className="text-xs text-gray-400">per month</p>
            </div>
          )}
        </div>

        {/* Usage meters */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 size={16} className="text-teal-600" />
              Usage This Month
            </h2>
            <span className="text-xs text-gray-400">
              Cycle started {new Date(usage.cycleStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            <UsageBar label="Messages Sent"  used={usage.messagesSent}   limit={usage.limits.messagesPerMonth} icon={MessageSquare} color="bg-teal-500" />
            <UsageBar label="Contacts"        used={usage.totalContacts}  limit={usage.limits.contacts}         icon={Users}         color="bg-blue-500" />
            <UsageBar label="Active Agents"   used={usage.totalAgents}    limit={usage.limits.agents}           icon={Users}         color="bg-purple-500" />
            <UsageBar label="Templates"       used={usage.totalTemplates} limit={usage.limits.templates}        icon={FileText}      color="bg-orange-400" />
            <UsageBar label="Channels"        used={usage.totalChannels}  limit={usage.limits.channels}         icon={Layout}        color="bg-indigo-400" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Zap size={14} className="text-gray-400" />Campaigns Sent
                </div>
                <span className="text-xs font-semibold text-gray-500">{usage.totalCampaigns.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${Math.min(100, usage.totalCampaigns * 5)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Plan comparison */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap size={16} className="text-teal-600" />Available Plans
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {planOrder.map((planKey, idx) => (
              <PlanCard
                key={planKey}
                planKey={planKey}
                plan={status.plans[planKey]}
                isCurrent={planKey === currentPlanKey}
                isUpgrade={idx > currentPlanIdx}
                isDowngrade={idx < currentPlanIdx}
                upgrading={upgrading === planKey}
                onSelect={() => { void handleUpgrade(planKey); }}
              />
            ))}
          </div>
        </div>

        {/* Billing email */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Mail size={16} className="text-teal-600" />Billing Email
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="billing@yourcompany.com"
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button onClick={() => { void handleSaveEmail(); }} disabled={savingEmail || !billingEmail.trim()}
              className="px-5 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 font-medium whitespace-nowrap">
              {savingEmail ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Invoices and billing notices are sent to this address.</p>
        </div>

        {/* Invoice history */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Download size={15} className="text-teal-600" />Invoice History
            </h2>
          </div>
          {invoices.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <CreditCard size={32} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No invoices yet</p>
              <p className="text-xs mt-1">Invoices appear here when you upgrade to a paid plan</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-700 font-medium">{inv.period}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{inv.description}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      ${inv.amount.toFixed(2)} <span className="text-xs font-normal text-gray-400">{inv.currency}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium',
                        inv.status === 'PAID' ? 'bg-teal-100 text-teal-700' :
                        inv.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-600')}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
