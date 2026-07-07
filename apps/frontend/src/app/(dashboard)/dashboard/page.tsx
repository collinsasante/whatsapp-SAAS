'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users, MessageSquare, CheckCircle, RefreshCw, AlertTriangle,
  TrendingUp, TrendingDown, Clock, Phone, Megaphone, ChevronRight,
  Plus, UserPlus, Radio, Inbox as InboxIcon, DollarSign, Timer, Building2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { dashboardApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getSocket, SocketEvent } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const POLL_INTERVAL_MS = 45_000;

interface Contact { id: string; name: string | null; phone: string }
interface UnassignedItem { id: string; createdAt: string; status: string; contact: Contact }
interface WindowClosingItem { conversationId: string; contact?: Contact; hoursRemaining: number }
interface SlaItem { id: string; status: string; slaDeadline: string | null; contact: Contact }
interface RevenueRow { currency: string; amount: number; count: number }
interface WhatsAppNumberHealth {
  id: string; label: string | null; qualityRating: string | null;
  messagingLimitTier: string | null; qualitySyncedAt: string | null;
}
interface ActivityItem { id: string; type: string; timestamp: string; data: Record<string, unknown> }
interface RecentCampaign {
  id: string; name: string; status: string;
  totalRecipients: number; sentCount: number; deliveredCount: number; readCount: number;
}
interface ChecklistItem { key: string; label: string; done: boolean; href: string }

interface MetaBusinessProfile {
  phone?: {
    verified_name?: string;
    display_phone_number?: string;
    quality_rating?: string;
    messaging_limit_tier?: string;
    code_verification_status?: string;
  };
  profile?: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  };
}

interface DashboardData {
  scope: 'tenant' | 'agent';
  needsAttention: {
    unassigned: { count: number; items: UnassignedItem[] };
    windowClosingSoon: { count: number; items: WindowClosingItem[] };
    slaBreaching: { count: number; items: SlaItem[] };
  };
  today: {
    newConversations: { today: number; yesterday: number; changePct: number | null };
    messagesSent: number;
    messagesReceived: number;
    medianFirstResponseSeconds: number | null;
    resolvedToday: number;
    revenue: RevenueRow[] | null;
  };
  health: {
    numbers: WhatsAppNumberHealth[];
    numbersConfigured: boolean;
    warning: boolean;
    recentRejection: { id: string; name: string; rejectionReason: string | null } | null;
  };
  activity: ActivityItem[];
  recentCampaigns: RecentCampaign[];
  setupChecklist: { items: ChecklistItem[]; completedCount: number; totalCount: number } | null;
}

function contactLabel(c?: Contact) {
  if (!c) return 'Unknown contact';
  return c.name?.trim() || c.phone;
}

function formatSeconds(total: number | null) {
  if (total == null) return '—';
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function qualityDot(rating: string | null) {
  if (rating === 'GREEN') return 'bg-green-500';
  if (rating === 'YELLOW') return 'bg-yellow-500';
  if (rating === 'RED') return 'bg-red-500';
  return 'bg-gray-300';
}

const ACTIVITY_META: Record<string, { label: (d: Record<string, unknown>) => string; icon: React.ElementType; color: string }> = {
  conversation_opened: { label: () => 'New conversation opened', icon: MessageSquare, color: 'text-teal-600' },
  conversation_resolved: { label: () => 'Conversation resolved', icon: CheckCircle, color: 'text-green-600' },
  payment_received: { label: (d) => `Payment received — ${d.currency} ${d.amount}`, icon: DollarSign, color: 'text-emerald-600' },
  campaign_completed: { label: (d) => `Campaign "${d.name}" completed (${d.sentCount} sent)`, icon: Megaphone, color: 'text-purple-600' },
  template_approved: { label: (d) => `Template "${d.name}" approved`, icon: CheckCircle, color: 'text-green-600' },
  template_rejected: { label: (d) => `Template "${d.name}" rejected`, icon: AlertTriangle, color: 'text-red-600' },
};

function Panel({ title, icon: Icon, children, action }: {
  title: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-teal-600" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, trend, urgent }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType;
  trend?: number | null; urgent?: boolean;
}) {
  return (
    <div className={cn('bg-white border rounded-2xl p-5 flex items-start gap-4', urgent ? 'border-orange-200 bg-orange-50/30' : 'border-gray-200')}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', urgent ? 'bg-orange-100' : 'bg-teal-100')}>
        <Icon size={18} className={urgent ? 'text-orange-600' : 'text-teal-600'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold mt-0.5 text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        {trend != null && (
          <div className={cn('flex items-center gap-0.5 text-xs font-medium mt-1', trend >= 0 ? 'text-green-600' : 'text-red-500')}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend)}% vs yesterday
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 text-center py-6">{text}</p>;
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-xs font-medium text-gray-800 text-right truncate max-w-56">
        {value || <span className="text-gray-400 italic">Not set</span>}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<MetaBusinessProfile | null>(null);
  const [businessProfileLoading, setBusinessProfileLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await dashboardApi.get();
      setData(res.data as DashboardData);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(() => { void load(true); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Live Meta Graph API data -- fetched once, separately from the main poll loop,
  // since it's a slow external call and shouldn't block or repeat with "today" stats.
  useEffect(() => {
    if (data?.scope !== 'tenant' || businessProfile || businessProfileLoading) return;
    setBusinessProfileLoading(true);
    dashboardApi.businessProfile()
      .then((res) => setBusinessProfile((res.data as MetaBusinessProfile | null) ?? null))
      .catch(() => setBusinessProfile(null))
      .finally(() => setBusinessProfileLoading(false));
  }, [data?.scope, businessProfile, businessProfileLoading]);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { void load(true); }, 1500);
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    socket.on(SocketEvent.NEW_MESSAGE, debouncedRefresh);
    socket.on(SocketEvent.CONVERSATION_UPDATED, debouncedRefresh);
    socket.on(SocketEvent.CONVERSATION_STATE_CHANGED, debouncedRefresh);
    return () => {
      socket.off(SocketEvent.NEW_MESSAGE, debouncedRefresh);
      socket.off(SocketEvent.CONVERSATION_UPDATED, debouncedRefresh);
      socket.off(SocketEvent.CONVERSATION_STATE_CHANGED, debouncedRefresh);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [debouncedRefresh]);

  const isAdmin = data?.scope === 'tenant';

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-gray-50 gap-3">
        <p className="text-sm text-gray-500">Couldn&apos;t load the dashboard.</p>
        <button
          onClick={() => { void load(); }}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl"
        >
          <RefreshCw size={14} />Retry
        </button>
      </div>
    );
  }

  const { needsAttention, today, health, activity, recentCampaigns, setupChecklist } = data;
  const totalAttention = needsAttention.unassigned.count + needsAttention.windowClosingSoon.count + needsAttention.slaBreaching.count;

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : 'Dashboard'}
            </h1>
          </div>
          <button
            onClick={() => { void load(true); }}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-gray-600"
          >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* Setup checklist (new tenants only, admin only) */}
        {setupChecklist && (
          <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Get set up</h2>
              <span className="text-xs font-medium text-teal-700">{setupChecklist.completedCount}/{setupChecklist.totalCount} done</span>
            </div>
            <div className="space-y-2">
              {setupChecklist.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => router.push(item.href)}
                  className="w-full flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-teal-100 hover:border-teal-300 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CheckCircle size={16} className={item.done ? 'text-green-500' : 'text-gray-300'} />
                    <span className={cn('text-xs font-medium truncate', item.done ? 'text-gray-400 line-through' : 'text-gray-800')}>{item.label}</span>
                  </div>
                  {!item.done && <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Needs attention */}
        <Panel
          title="Needs attention"
          icon={AlertTriangle}
          action={totalAttention > 0 ? (
            <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">{totalAttention}</span>
          ) : undefined}
        >
          {totalAttention === 0 ? (
            <div className="flex items-center gap-2 text-green-600 py-2">
              <CheckCircle size={16} />
              <span className="text-xs font-medium">All caught up — nothing needs attention</span>
            </div>
          ) : (
            <div className="space-y-4">
              {needsAttention.unassigned.count > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Unassigned ({needsAttention.unassigned.count})</p>
                  <div className="space-y-1">
                    {needsAttention.unassigned.items.map((c) => (
                      <button key={c.id} onClick={() => router.push(`/inbox?c=${c.id}`)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-left transition-colors">
                        <span className="text-xs text-gray-700 truncate">{contactLabel(c.contact)}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(c.createdAt)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {needsAttention.windowClosingSoon.count > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">24h window closing soon ({needsAttention.windowClosingSoon.count})</p>
                  <div className="space-y-1">
                    {needsAttention.windowClosingSoon.items.map((c) => (
                      <button key={c.conversationId} onClick={() => router.push(`/inbox?c=${c.conversationId}`)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-orange-50 hover:bg-orange-100 rounded-lg text-left transition-colors">
                        <span className="text-xs text-gray-700 truncate">{contactLabel(c.contact)}</span>
                        <span className="text-[10px] text-orange-600 font-medium flex-shrink-0 flex items-center gap-1">
                          <Timer size={10} />{c.hoursRemaining}h left
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {needsAttention.slaBreaching.count > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">SLA breaching ({needsAttention.slaBreaching.count})</p>
                  <div className="space-y-1">
                    {needsAttention.slaBreaching.items.map((c) => (
                      <button key={c.id} onClick={() => router.push(`/inbox?c=${c.id}`)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-red-50 hover:bg-red-100 rounded-lg text-left transition-colors">
                        <span className="text-xs text-gray-700 truncate">{contactLabel(c.contact)}</span>
                        <span className="text-[10px] text-red-600 font-medium flex-shrink-0">{c.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* Today at a glance */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Today at a glance</h2>
          <div className={cn('grid grid-cols-2 gap-3 md:gap-4', isAdmin ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-4')}>
            <StatCard
              label="New conversations"
              value={today.newConversations.today}
              icon={MessageSquare}
              trend={today.newConversations.changePct}
            />
            <StatCard label="Messages sent" value={today.messagesSent} icon={TrendingUp} />
            <StatCard label="Messages received" value={today.messagesReceived} icon={InboxIcon} />
            <StatCard label="Resolved today" value={today.resolvedToday} icon={CheckCircle} />
            <StatCard label="Median first response" value={formatSeconds(today.medianFirstResponseSeconds)} icon={Clock} />
            {isAdmin && today.revenue && (
              <StatCard
                label="Revenue today"
                value={today.revenue.length === 0 ? '—' : today.revenue.map((r) => `${r.currency} ${r.amount}`).join(' · ')}
                icon={DollarSign}
              />
            )}
          </div>
        </div>

        {/* WhatsApp health strip */}
        <Panel title="WhatsApp health" icon={Radio}>
          {!health.numbersConfigured ? (
            <div className="flex items-center justify-between gap-4 py-1">
              <p className="text-xs text-gray-500">No WhatsApp number connected yet</p>
              <button onClick={() => router.push('/channels')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg">
                <Plus size={12} />Connect
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {health.warning && (
                <div className="flex items-center gap-2 p-2.5 bg-orange-50 border border-orange-200 rounded-lg">
                  <AlertTriangle size={14} className="text-orange-600 flex-shrink-0" />
                  <span className="text-xs text-orange-700">
                    {health.recentRejection
                      ? `Template "${health.recentRejection.name}" was recently rejected`
                      : 'One or more numbers has a degraded quality rating'}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {health.numbers.map((n) => (
                  <div key={n.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg">
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', qualityDot(n.qualityRating))} />
                    <span className="text-xs font-medium text-gray-700">{n.label ?? 'WhatsApp number'}</span>
                    <span className="text-[10px] text-gray-400">{n.qualityRating ?? 'Unknown'}{n.messagingLimitTier ? ` · ${n.messagingLimitTier}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Business profile (live Meta Graph API data, admin only) */}
        {isAdmin && (
          <Panel title="Business profile" icon={Building2}>
            <p className="text-[10px] text-gray-400 mb-2">Live data from Meta Business API</p>
            {businessProfileLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
                <div className="h-4 bg-gray-100 rounded w-2/3" />
              </div>
            ) : !businessProfile ? (
              <EmptyRow text="Couldn't load Meta business profile" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                <div>
                  <InfoRow label="Business name" value={businessProfile.phone?.verified_name} />
                  <InfoRow label="Phone number" value={businessProfile.phone?.display_phone_number} />
                  <InfoRow label="Quality rating" value={businessProfile.phone?.quality_rating} />
                  <InfoRow label="Messaging limit" value={businessProfile.phone?.messaging_limit_tier} />
                  <InfoRow label="Verification" value={businessProfile.phone?.code_verification_status} />
                </div>
                <div>
                  <InfoRow label="About" value={businessProfile.profile?.about} />
                  <InfoRow label="Description" value={businessProfile.profile?.description} />
                  <InfoRow label="Industry" value={businessProfile.profile?.vertical} />
                  <InfoRow label="Address" value={businessProfile.profile?.address} />
                  <InfoRow label="Email" value={businessProfile.profile?.email} />
                  <InfoRow label="Website" value={businessProfile.profile?.websites?.[0]} />
                </div>
              </div>
            )}
          </Panel>
        )}

        {/* Two-column: activity feed | recent campaigns + quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel title="Live activity" icon={Radio}>
            {activity.length === 0 ? (
              <EmptyRow text="No activity yet" />
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {activity.map((item) => {
                  const meta = ACTIVITY_META[item.type];
                  const Icon = meta?.icon ?? MessageSquare;
                  return (
                    <div key={`${item.type}-${item.id}`} className="flex items-start gap-2.5">
                      <Icon size={14} className={cn('mt-0.5 flex-shrink-0', meta?.color ?? 'text-gray-400')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700">{meta ? meta.label(item.data) : item.type}</p>
                        <p className="text-[10px] text-gray-400">{timeAgo(item.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <div className="space-y-5">
            <Panel
              title="Recent campaigns"
              icon={Megaphone}
              action={<button onClick={() => router.push('/campaigns')} className="text-xs text-teal-600 hover:underline">View all</button>}
            >
              {recentCampaigns.length === 0 ? (
                <EmptyRow text="No campaigns sent yet" />
              ) : (
                <div className="space-y-2">
                  {recentCampaigns.map((c) => (
                    <button key={c.id} onClick={() => router.push(`/campaigns/${c.id}`)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-left transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{c.name}</p>
                        <p className="text-[10px] text-gray-400">{c.status} · {c.sentCount}/{c.totalRecipients} sent</p>
                      </div>
                      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Quick actions" icon={Plus}>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => router.push('/inbox')}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-700 transition-colors">
                  <InboxIcon size={14} className="text-teal-600" />Open inbox
                </button>
                <button onClick={() => router.push('/contacts')}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-700 transition-colors">
                  <Users size={14} className="text-blue-600" />View contacts
                </button>
                {isAdmin && (
                  <>
                    <button onClick={() => router.push('/campaigns')}
                      className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-700 transition-colors">
                      <Megaphone size={14} className="text-purple-600" />New broadcast
                    </button>
                    <button onClick={() => router.push('/manage')}
                      className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-700 transition-colors">
                      <UserPlus size={14} className="text-emerald-600" />Invite teammate
                    </button>
                  </>
                )}
                <button onClick={() => router.push('/calls')}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-700 transition-colors">
                  <Phone size={14} className="text-orange-600" />Calls
                </button>
              </div>
            </Panel>
          </div>
        </div>

      </div>
    </div>
  );
}
