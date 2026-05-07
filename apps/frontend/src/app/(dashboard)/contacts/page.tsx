'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Upload } from 'lucide-react';
import { contactsApi, conversationsApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/store/inbox.store';
import toast from 'react-hot-toast';
import { formatRelativeTime } from '@/lib/utils';

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  labels: string[];
  isBlocked: boolean;
  optedOut: boolean;
  createdAt: string;
}

export default function ContactsPage() {
  const router = useRouter();
  const { setActiveConversation, prependConversation } = useInboxStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const csvInputRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 50;

  const load = async (reset = true) => {
    if (reset) { setLoading(true); setPage(1); } else setLoadingMore(true);
    const currentPage = reset ? 1 : page + 1;
    try {
      const res = await contactsApi.list({ search: search || undefined, limit: PAGE_SIZE, page: currentPage });
      const data = res.data as { data: Contact[]; meta: { total: number } };
      setContacts((prev) => reset ? data.data : [...prev, ...data.data]);
      setTotal(data.meta.total);
      if (!reset) setPage(currentPage);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => { void load(true); }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
      const phoneIdx = header.indexOf('phone');
      const nameIdx = header.indexOf('name');
      const emailIdx = header.indexOf('email');
      if (phoneIdx === -1) { toast.error('CSV must have a "phone" column'); return; }
      const contacts = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/"/g, ''));
        return {
          phone: cols[phoneIdx] ?? '',
          name: nameIdx !== -1 ? cols[nameIdx] || undefined : undefined,
          email: emailIdx !== -1 ? cols[emailIdx] || undefined : undefined,
        };
      }).filter((c) => c.phone);
      if (!contacts.length) { toast.error('No valid contacts found in CSV'); return; }
      await contactsApi.import(contacts);
      await load();
      toast.success(`Imported ${contacts.length} contacts`);
    } catch {
      toast.error('Failed to import contacts');
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const messageContact = async (contact: Contact) => {
    try {
      const res = await conversationsApi.create({ contactId: contact.id });
      const conv = res.data as { id: string; contact: { id: string; name: string | null; phone: string; avatarUrl: string | null }; assignedTo: null; status: string; unreadCount: number; lastMessageAt: string | null; labels: string[] };
      prependConversation(conv);
      setActiveConversation(conv.id);
      router.push('/inbox');
    } catch {
      toast.error('Failed to open conversation');
    }
  };

  const createContact = async () => {
    try {
      await contactsApi.create(form);
      setShowCreate(false);
      setForm({ name: '', phone: '', email: '' });
      await load();
      toast.success('Contact created');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to create contact'
        : 'Failed to create contact';
      toast.error(typeof msg === 'string' ? msg : 'Failed to create contact');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
            <p className="text-sm text-gray-500">{total.toLocaleString()} contacts</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { void handleCsvImport(e); }} />
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <Upload size={16} />
              {importing ? 'Importing...' : 'Import CSV'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus size={16} />
              New Contact
            </button>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Labels</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Added</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{contact.name ?? '—'}</span>
                      {contact.isBlocked && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Blocked</span>}
                      {contact.optedOut && <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Opted Out</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{contact.phone}</td>
                    <td className="px-4 py-3 text-gray-600">{contact.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {contact.labels.map((label) => (
                          <span key={label} className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{label}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatRelativeTime(contact.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => { void messageContact(contact); }} className="text-xs text-green-600 hover:underline font-medium">Message</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {contacts.length < total && !loading && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => { void load(false); }}
              disabled={loadingMore}
              className="px-5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : `Load more (${contacts.length} of ${total})`}
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Contact</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Full Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <input
                type="tel"
                required
                placeholder="Phone (e.g. +1234567890)"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { void createContact(); }}
                className="flex-1 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Create Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
