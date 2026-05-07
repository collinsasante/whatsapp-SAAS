'use client';
import { useEffect, useState } from 'react';
import { Users, MessageSquare, Send, Megaphone, TrendingUp, CheckCircle, Clock, XCircle } from 'lucide-react';
import { tenantApi, conversationsApi, campaignsApi } from '@/lib/api';

interface Stats {
  contacts: number;
  conversations: number;
  messages: number;
  campaigns: number;
}

interface ConversationBreakdown {
  open: number;
  resolved: number;
  pending: number;
}

interface CampaignBreakdown {
  draft: number;
  running: number;
  completed: number;
  failed: number;
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
    </div>
  );
}

function BreakdownBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium text-gray-900">{value.toLocaleString()} <span className="text-gray-400 font-normal">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [conversations, setConversations] = useState<ConversationBreakdown>({ open: 0, resolved: 0, pending: 0 });
  const [campaigns, setCampaigns] = useState<CampaignBreakdown>({ draft: 0, running: 0, completed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, openRes, resolvedRes, pendingRes, campaignsRes] = await Promise.all([
          tenantApi.getStats(),
          conversationsApi.list({ status: 'OPEN', limit: 1 }),
          conversationsApi.list({ status: 'RESOLVED', limit: 1 }),
          conversationsApi.list({ status: 'PENDING', limit: 1 }),
          campaignsApi.list({ limit: 100 }),
        ]);

        setStats(statsRes.data as Stats);

        const open = (openRes.data as { meta: { total: number } }).meta?.total ?? 0;
        const resolved = (resolvedRes.data as { meta: { total: number } }).meta?.total ?? 0;
        const pending = (pendingRes.data as { meta: { total: number } }).meta?.total ?? 0;
        setConversations({ open, resolved, pending });

        const allCampaigns = (campaignsRes.data as { data: { status: string }[] }).data ?? [];
        setCampaigns({
          draft: allCampaigns.filter((c) => c.status === 'DRAFT').length,
          running: allCampaigns.filter((c) => c.status === 'RUNNING').length,
          completed: allCampaigns.filter((c) => c.status === 'COMPLETED').length,
          failed: allCampaigns.filter((c) => c.status === 'FAILED').length,
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
      </div>
    );
  }

  const totalConversations = conversations.open + conversations.resolved + conversations.pending;
  const totalCampaigns = campaigns.draft + campaigns.running + campaigns.completed + campaigns.failed;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={20} className="text-green-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500">Overview of your workspace activity</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Total Contacts" value={stats?.contacts ?? 0} color="bg-blue-50 text-blue-600" />
          <StatCard icon={MessageSquare} label="Conversations" value={stats?.conversations ?? 0} color="bg-green-50 text-green-600" />
          <StatCard icon={Send} label="Messages Sent" value={stats?.messages ?? 0} color="bg-purple-50 text-purple-600" />
          <StatCard icon={Megaphone} label="Campaigns" value={stats?.campaigns ?? 0} color="bg-orange-50 text-orange-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Conversations by Status</h2>
            {totalConversations === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No conversations yet</p>
            ) : (
              <div className="space-y-4">
                <BreakdownBar label="Open" value={conversations.open} total={totalConversations} color="bg-green-500" />
                <BreakdownBar label="Pending" value={conversations.pending} total={totalConversations} color="bg-yellow-400" />
                <BreakdownBar label="Resolved" value={conversations.resolved} total={totalConversations} color="bg-gray-400" />
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Campaigns by Status</h2>
            {totalCampaigns === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No campaigns yet</p>
            ) : (
              <div className="space-y-4">
                <BreakdownBar label="Running" value={campaigns.running} total={totalCampaigns} color="bg-green-500" />
                <BreakdownBar label="Completed" value={campaigns.completed} total={totalCampaigns} color="bg-blue-500" />
                <BreakdownBar label="Draft" value={campaigns.draft} total={totalCampaigns} color="bg-gray-300" />
                <BreakdownBar label="Failed" value={campaigns.failed} total={totalCampaigns} color="bg-red-400" />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Stats</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
              <CheckCircle size={18} className="text-green-600 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Open</p>
                <p className="text-lg font-bold text-gray-900">{conversations.open}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg">
              <Clock size={18} className="text-yellow-600 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Pending</p>
                <p className="text-lg font-bold text-gray-900">{conversations.pending}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <CheckCircle size={18} className="text-blue-600 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Resolved</p>
                <p className="text-lg font-bold text-gray-900">{conversations.resolved}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
              <XCircle size={18} className="text-red-500 shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Failed Campaigns</p>
                <p className="text-lg font-bold text-gray-900">{campaigns.failed}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
