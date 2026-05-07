'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, FileText } from 'lucide-react';
import { templatesApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn, formatRelativeTime } from '@/lib/utils';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  REJECTED: 'bg-red-100 text-red-700',
  PAUSED: 'bg-gray-100 text-gray-600',
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await templatesApi.list({ limit: 100 });
      setTemplates((res.data as { data: Template[] }).data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      await templatesApi.sync();
      await load();
      toast.success('Templates synced from WhatsApp');
    } catch {
      toast.error('Failed to sync templates. Check WhatsApp API configuration.');
    } finally {
      setSyncing(false);
    }
  };

  const getBodyText = (template: Template) => {
    const body = template.components.find((c) => c.type === 'BODY');
    return body?.text ?? 'No body text';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Message Templates</h1>
            <p className="text-sm text-gray-500">WhatsApp approved message templates</p>
          </div>
          <button
            onClick={() => { void sync(); }}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync from WhatsApp'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
        ) : templates.length === 0 ? (
          <div className="text-center pt-16 text-gray-400">
            <FileText size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No templates yet</p>
            <p className="text-sm">Sync templates from your WhatsApp Business API</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <div key={template.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{template.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{template.language} · {template.category}</p>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[template.status] ?? 'bg-gray-100 text-gray-600')}>
                    {template.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 line-clamp-3 bg-gray-50 p-3 rounded-lg">
                  {getBodyText(template)}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-gray-400">{formatRelativeTime(template.createdAt)}</p>
                  <div className="flex gap-1">
                    {template.components.map((c) => (
                      <span key={c.type} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                        {c.type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
