import { AlertTriangle, CheckCircle2, Clock, Info, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'pending';

const TONES: Record<PillTone, { cls: string; icon: React.ElementType }> = {
  success: { cls: 'bg-green-50 text-green-800 ring-green-600/20', icon: CheckCircle2 },
  warning: { cls: 'bg-amber-50 text-amber-800 ring-amber-600/25', icon: AlertTriangle },
  danger: { cls: 'bg-red-50 text-red-800 ring-red-600/20', icon: XCircle },
  neutral: { cls: 'bg-gray-100 text-gray-700 ring-gray-500/20', icon: MinusCircle },
  info: { cls: 'bg-blue-50 text-blue-800 ring-blue-600/20', icon: Info },
  pending: { cls: 'bg-blue-50 text-blue-800 ring-blue-600/20', icon: Clock },
};

/** A status as an icon and a word, so it never depends on colour alone to be understood. */
export function StatusPill({ tone = 'neutral', children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  const { cls, icon: Icon } = TONES[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', cls, className)}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

const TENANT_STATUS: Record<string, { tone: PillTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  trial: { tone: 'pending', label: 'Trial' },
  past_due: { tone: 'warning', label: 'Past due' },
  suspended: { tone: 'danger', label: 'Suspended' },
  churned: { tone: 'neutral', label: 'Churned' },
  no_subscription: { tone: 'neutral', label: 'No plan' },
};

/** The combined account and subscription status shown in the tenant directory. */
export function TenantStatus({ status }: { status: string }) {
  const s = TENANT_STATUS[status] ?? { tone: 'neutral' as PillTone, label: status };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

const SUBSCRIPTION_STATUS: Record<string, { tone: PillTone; label: string }> = {
  ACTIVE: { tone: 'success', label: 'Active' },
  TRIAL: { tone: 'pending', label: 'Trial' },
  PAST_DUE: { tone: 'warning', label: 'Past due' },
  SUSPENDED: { tone: 'danger', label: 'Suspended' },
  CANCELED: { tone: 'neutral', label: 'Canceled' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
};

export function SubscriptionStatus({ status }: { status: string }) {
  const s = SUBSCRIPTION_STATUS[status] ?? { tone: 'neutral' as PillTone, label: status };
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

export function AccountStatus({ active }: { active: boolean }) {
  return active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill tone="danger">Suspended</StatusPill>;
}
