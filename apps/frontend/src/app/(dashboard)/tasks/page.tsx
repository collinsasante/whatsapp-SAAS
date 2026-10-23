'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { internalTasksApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Task {
  id: string;
  department: string;
  title: string;
  description: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  conversationId: string | null;
  orderId: string | null;
  createdAt: string;
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

const STATUS_STYLE: Record<Task['status'], string> = {
  OPEN: 'bg-amber-50 text-amber-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-600',
  DONE: 'bg-green-50 text-green-600',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

const PRIORITY_STYLE: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-500',
  NORMAL: 'bg-gray-100 text-gray-600',
  HIGH: 'bg-orange-50 text-orange-600',
  URGENT: 'bg-red-50 text-red-600',
};

const FILTERS: { label: string; value: Task['status'] | 'ALL' }[] = [
  { label: 'Open', value: 'OPEN' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Done', value: 'DONE' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'All', value: 'ALL' },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Task['status'] | 'ALL'>('OPEN');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async (status: Task['status'] | 'ALL') => {
    setRefreshing(true);
    try {
      const res = await internalTasksApi.list(status === 'ALL' ? undefined : { status });
      setTasks(res.data as Task[]);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load tasks'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [load, filter]);

  const updateStatus = async (id: string, status: 'DONE' | 'CANCELLED') => {
    setUpdatingId(id);
    try {
      await internalTasksApi.updateStatus(id, status);
      toast.success(status === 'DONE' ? 'Task marked done' : 'Task cancelled');
      await load(filter);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to update task'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center">
              <ClipboardList size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Tasks</h1>
              <p className="text-xs text-gray-500">Work handed off from Verz AI to your team -- order approvals, forwarded requests, and follow-ups</p>
            </div>
          </div>
          <button
            onClick={() => load(filter)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
          </button>
        </div>
        <div className="flex items-center gap-1.5 mt-3">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                filter === f.value ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-20 animate-pulse" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No {filter === 'ALL' ? '' : filter.toLowerCase().replace('_', ' ')} tasks right now.
            </div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_STYLE[t.status])}>
                        {t.status.replace('_', ' ')}
                      </span>
                      <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap', PRIORITY_STYLE[t.priority])}>
                        {t.priority}
                      </span>
                      <span className="text-[11px] text-gray-400">{t.department}</span>
                    </div>
                    <div className="text-sm font-semibold text-gray-900 mt-1.5">{t.title}</div>
                    {t.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.description}</div>}
                    <div className="flex items-center gap-3 mt-2">
                      {t.conversationId && (
                        <Link href={`/inbox?c=${t.conversationId}`} className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                          View conversation <ExternalLink size={11} />
                        </Link>
                      )}
                      {t.orderId && (
                        <Link href="/commerce/orders" className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                          View order <ExternalLink size={11} />
                        </Link>
                      )}
                      <span className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {(t.status === 'OPEN' || t.status === 'IN_PROGRESS') && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateStatus(t.id, 'DONE')}
                        disabled={updatingId === t.id}
                        title="Mark done"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                      <button
                        onClick={() => updateStatus(t.id, 'CANCELLED')}
                        disabled={updatingId === t.id}
                        title="Cancel"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
