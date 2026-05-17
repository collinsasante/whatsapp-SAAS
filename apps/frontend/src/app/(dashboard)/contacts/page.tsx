'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search, Plus, Upload, Edit2, Trash2, MessageSquare, X,
  ChevronLeft, ChevronRight, Phone, Mail, Tag, Calendar,
  User, Wifi, Globe, Languages, AlertCircle, ExternalLink,
  Users, Filter, ChevronDown, ChevronRight as CRight, Loader2,
  CheckCircle2, AlertTriangle, FolderOpen, Download, TagIcon,
  PanelRightClose,
} from 'lucide-react';
import { contactsApi, conversationsApi, segmentsApi, tagsApi, messagesApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useInboxStore } from '@/store/inbox.store';
import type { StatusCounts } from '@/store/inbox.store';
import toast from 'react-hot-toast';
import { formatRelativeTime, cn } from '@/lib/utils';
import ChatWindow from '@/components/inbox/ChatWindow';
import ConversationDetails from '@/components/inbox/ConversationDetails';

// ─── Types ─────────────────────────────────────────────────────────────────
interface Segment { id: string; name: string; description?: string; filters: unknown[]; contactCount: number }

// ─── CSV Import Modal ─────────────────────────────────────────────────────
const CONTACT_FIELDS = ['phone', 'name', 'email', 'labels', 'country', 'language'] as const;
type ContactField = typeof CONTACT_FIELDS[number];

function CsvImportModal({ onClose, onDone }: { onClose: () => void; onDone: (count: number) => void }) {
  const [step, setStep] = useState<'upload' | 'map' | 'result'>('upload');
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, ContactField | ''>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) { toast.error('Empty file'); return; }
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const splitRow = (line: string) => line.split(delim).map(c => c.replace(/"/g, '').trim());
      const h = splitRow(lines[0]);
      const r = lines.slice(1).map(splitRow);
      setHeaders(h);
      setRows(r);
      // Auto-map obvious columns
      const auto: Record<string, ContactField | ''> = {};
      h.forEach(col => {
        const lc = col.toLowerCase().replace(/\s+/g, '');
        if (lc.includes('phone') || lc.includes('mobile') || lc === 'usernumber' || lc.includes('number')) auto[col] = 'phone';
        else if (lc === 'name' || lc.includes('firstname') || lc.includes('fullname')) auto[col] = 'name';
        else if (lc.includes('email')) auto[col] = 'email';
        else if (lc.includes('tag') || lc.includes('label')) auto[col] = 'labels';
        else if (lc.includes('country')) auto[col] = 'country';
        else if (lc.includes('lang')) auto[col] = 'language';
        else auto[col] = '';
      });
      setMapping(auto);
      setStep('map');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) parseFile(file);
    else toast.error('Please drop a CSV file');
  };

  const handleImport = async () => {
    const phoneCol = Object.entries(mapping).find(([, v]) => v === 'phone')?.[0];
    if (!phoneCol) { toast.error('Map a column to Phone first'); return; }

    setImporting(true);
    const CHUNK = 500;
    const totals = { created: 0, skipped: 0, errors: [] as string[] };
    try {
      const contacts = rows.map(row => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          const field = mapping[h];
          if (!field) return;
          const val = (row[i] ?? '').trim();
          if (!val) return; // skip empty cells so optional validators don't see ''
          if (field === 'labels') {
            obj[field] = val.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
          } else {
            obj[field] = val;
          }
        });
        return obj;
      }).filter(c => (c.phone as string)?.trim());

      console.log('[import] contacts to send:', contacts.length, 'first sample:', contacts[0]);
      const totalChunks = Math.ceil(contacts.length / CHUNK);
      for (let i = 0; i < contacts.length; i += CHUNK) {
        const chunk = contacts.slice(i, i + CHUNK);
        const chunkNum = Math.floor(i / CHUNK) + 1;
        setImportProgress(`Importing batch ${chunkNum} of ${totalChunks}…`);
        console.log(`[import] sending batch ${chunkNum}/${totalChunks} (${chunk.length} contacts)`);
        const res = await contactsApi.import(chunk);
        const data = res.data as { created: number; skipped: number; errors: string[] };
        console.log(`[import] batch ${chunkNum} result:`, data);
        totals.created += data.created;
        totals.skipped += data.skipped;
        totals.errors.push(...data.errors);
      }

      setResult(totals);
      setStep('result');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } };
      console.error('[import] error:', axiosErr.response?.status, axiosErr.response?.data ?? err);
      const msg = axiosErr.response?.data?.message;
      const detail = Array.isArray(msg) ? msg[0] : msg;
      toast.error(detail ? `Import failed: ${detail}` : 'Import failed');
    }
    finally { setImporting(false); setImportProgress(''); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Import Contacts</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload' ? 'Upload a CSV file' : step === 'map' ? `${rows.length} rows · Map columns to fields` : 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Step: Upload */}
        {step === 'upload' && (
          <div className="p-6">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-colors',
                dragging ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-teal-300 hover:bg-gray-50'
              )}
            >
              <div className="w-12 h-12 bg-teal-50 rounded-xl flex items-center justify-center">
                <Upload className="w-6 h-6 text-teal-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Drop your CSV here, or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">Columns: UserNumber (required), Name, Tags, Status, Opted In, and more</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
            <div className="mt-4 p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-500 font-medium">Sample CSV format:</p>
                <a
                  href={`data:text/csv;charset=utf-8,${encodeURIComponent('Name\tUserNumber\tTags\tLast Active\tCreated On\tFirst Message\tSource\tStatus\tOpted In\tIntervened By\nJohn Doe\t+1234567890\tVIP\t\t\t\tdirect\tactive\tYes\t\nJane Smith\t+9876543210\tcustomer\t\t\t\twhatsapp\tactive\tYes\t\nAlice Brown\t+447911123456\tlead\t\t\t\tdirect\tactive\tYes\t')}`}
                  download="contacts_sample.csv"
                  className="text-[10px] text-teal-600 hover:text-teal-700 font-medium flex items-center gap-0.5"
                  onClick={e => e.stopPropagation()}
                >
                  ↓ Download sample
                </a>
              </div>
              <pre className="text-[10px] text-gray-400 font-mono overflow-x-auto">{'Name\tUserNumber\tTags\tLast Active\tCreated On\tFirst Message\tSource\tStatus\tOpted In\tIntervened By'}</pre>
            </div>
          </div>
        )}

        {/* Step: Map */}
        {step === 'map' && (
          <div className="p-6 space-y-4">
            <div className="overflow-auto max-h-52 border border-gray-200 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {headers.map((_, j) => (
                        <td key={j} className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{row[j] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Map columns to contact fields</p>
              <div className="grid grid-cols-2 gap-2">
                {headers.map(h => (
                  <div key={h} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded flex-1 truncate">{h}</span>
                    <span className="text-gray-300 text-xs">→</span>
                    <select
                      value={mapping[h] ?? ''}
                      onChange={e => setMapping(p => ({ ...p, [h]: e.target.value as ContactField | '' }))}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="">Skip</option>
                      {CONTACT_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep('upload')} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
              <button onClick={() => { void handleImport(); }} disabled={importing}
                className="flex items-center gap-2 px-5 py-2 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? (importProgress || 'Importing…') : `Import ${rows.length} contacts`}
              </button>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && result && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-green-700">{result.created}</p>
                <p className="text-xs text-green-600">Imported</p>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
                <AlertTriangle className="w-6 h-6 text-yellow-600 mx-auto mb-1" />
                <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
                <p className="text-xs text-yellow-600">Skipped</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <X className="w-6 h-6 text-red-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-red-600">{result.errors.length}</p>
                <p className="text-xs text-red-500">Errors</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="bg-red-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                {result.errors.slice(0, 10).map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}
            <button onClick={() => { onDone(result.created); onClose(); }}
              className="w-full py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Segment Modal ────────────────────────────────────────────────────
const FILTER_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'label', label: 'Tag/Label' },
  { value: 'optedOut', label: 'Opted Out' },
  { value: 'isBlocked', label: 'Is Blocked' },
];
const FILTER_OPS: Record<string, { value: string; label: string }[]> = {
  name:      [{ value: 'contains', label: 'contains' }, { value: 'equals', label: 'equals' }, { value: 'startsWith', label: 'starts with' }],
  phone:     [{ value: 'contains', label: 'contains' }],
  email:     [{ value: 'contains', label: 'contains' }, { value: 'equals', label: 'equals' }],
  label:     [{ value: 'has', label: 'has tag' }, { value: 'notHas', label: 'does not have tag' }],
  optedOut:  [{ value: 'isTrue', label: 'is opted out' }, { value: 'isFalse', label: 'is opted in' }],
  isBlocked: [{ value: 'isTrue', label: 'is blocked' }, { value: 'isFalse', label: 'is not blocked' }],
};

interface FilterRow { field: string; operator: string; value: string }

function CreateSegmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Segment) => void }) {
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<FilterRow[]>([{ field: 'label', operator: 'has', value: '' }]);
  const [saving, setSaving] = useState(false);

  const addFilter = () => setFilters(p => [...p, { field: 'label', operator: 'has', value: '' }]);
  const removeFilter = (i: number) => setFilters(p => p.filter((_, j) => j !== i));
  const updateFilter = (i: number, patch: Partial<FilterRow>) => setFilters(p =>
    p.map((f, j) => j === i ? { ...f, ...patch, ...(patch.field && { operator: FILTER_OPS[patch.field]?.[0]?.value ?? 'contains' }) } : f)
  );

  const needsValue = (field: string) => !['optedOut', 'isBlocked'].includes(field);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Segment name required'); return; }
    setSaving(true);
    try {
      const res = await segmentsApi.create({ name, filters: filters.filter(f => !needsValue(f.field) || f.value.trim()) });
      onCreated(res.data as Segment);
      onClose();
    } catch { toast.error('Failed to create segment'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Create Segment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Segment Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. VIP Customers"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Filter Rules <span className="text-gray-400 font-normal">(ALL conditions must match)</span></p>
            <div className="space-y-2">
              {filters.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={f.field} onChange={e => updateFilter(i, { field: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white">
                    {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
                  </select>
                  <select value={f.operator} onChange={e => updateFilter(i, { operator: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white">
                    {(FILTER_OPS[f.field] ?? []).map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  {needsValue(f.field) && (
                    <input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })}
                      placeholder="value"
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500" />
                  )}
                  <button onClick={() => removeFilter(i)} className="text-gray-300 hover:text-red-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <button onClick={addFilter}
              className="mt-2 text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1 font-medium">
              <Plus className="w-3.5 h-3.5" /> Add condition
            </button>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
            <button onClick={() => { void handleCreate(); }} disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Segment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Phone → Country ───────────────────────────────────────────────────────
const DIAL_MAP: Record<string, { name: string; flag: string }> = {
  '1': { name: 'United States', flag: '🇺🇸' },
  '7': { name: 'Russia', flag: '🇷🇺' },
  '20': { name: 'Egypt', flag: '🇪🇬' },
  '27': { name: 'South Africa', flag: '🇿🇦' },
  '30': { name: 'Greece', flag: '🇬🇷' },
  '31': { name: 'Netherlands', flag: '🇳🇱' },
  '32': { name: 'Belgium', flag: '🇧🇪' },
  '33': { name: 'France', flag: '🇫🇷' },
  '34': { name: 'Spain', flag: '🇪🇸' },
  '36': { name: 'Hungary', flag: '🇭🇺' },
  '39': { name: 'Italy', flag: '🇮🇹' },
  '40': { name: 'Romania', flag: '🇷🇴' },
  '41': { name: 'Switzerland', flag: '🇨🇭' },
  '43': { name: 'Austria', flag: '🇦🇹' },
  '44': { name: 'United Kingdom', flag: '🇬🇧' },
  '45': { name: 'Denmark', flag: '🇩🇰' },
  '46': { name: 'Sweden', flag: '🇸🇪' },
  '47': { name: 'Norway', flag: '🇳🇴' },
  '48': { name: 'Poland', flag: '🇵🇱' },
  '49': { name: 'Germany', flag: '🇩🇪' },
  '51': { name: 'Peru', flag: '🇵🇪' },
  '52': { name: 'Mexico', flag: '🇲🇽' },
  '53': { name: 'Cuba', flag: '🇨🇺' },
  '54': { name: 'Argentina', flag: '🇦🇷' },
  '55': { name: 'Brazil', flag: '🇧🇷' },
  '56': { name: 'Chile', flag: '🇨🇱' },
  '57': { name: 'Colombia', flag: '🇨🇴' },
  '58': { name: 'Venezuela', flag: '🇻🇪' },
  '60': { name: 'Malaysia', flag: '🇲🇾' },
  '61': { name: 'Australia', flag: '🇦🇺' },
  '62': { name: 'Indonesia', flag: '🇮🇩' },
  '63': { name: 'Philippines', flag: '🇵🇭' },
  '64': { name: 'New Zealand', flag: '🇳🇿' },
  '65': { name: 'Singapore', flag: '🇸🇬' },
  '66': { name: 'Thailand', flag: '🇹🇭' },
  '81': { name: 'Japan', flag: '🇯🇵' },
  '82': { name: 'South Korea', flag: '🇰🇷' },
  '84': { name: 'Vietnam', flag: '🇻🇳' },
  '86': { name: 'China', flag: '🇨🇳' },
  '90': { name: 'Turkey', flag: '🇹🇷' },
  '91': { name: 'India', flag: '🇮🇳' },
  '92': { name: 'Pakistan', flag: '🇵🇰' },
  '94': { name: 'Sri Lanka', flag: '🇱🇰' },
  '98': { name: 'Iran', flag: '🇮🇷' },
  '212': { name: 'Morocco', flag: '🇲🇦' },
  '213': { name: 'Algeria', flag: '🇩🇿' },
  '216': { name: 'Tunisia', flag: '🇹🇳' },
  '218': { name: 'Libya', flag: '🇱🇾' },
  '220': { name: 'Gambia', flag: '🇬🇲' },
  '221': { name: 'Senegal', flag: '🇸🇳' },
  '222': { name: 'Mauritania', flag: '🇲🇷' },
  '223': { name: 'Mali', flag: '🇲🇱' },
  '224': { name: 'Guinea', flag: '🇬🇳' },
  '225': { name: 'Ivory Coast', flag: '🇨🇮' },
  '226': { name: 'Burkina Faso', flag: '🇧🇫' },
  '227': { name: 'Niger', flag: '🇳🇪' },
  '228': { name: 'Togo', flag: '🇹🇬' },
  '229': { name: 'Benin', flag: '🇧🇯' },
  '230': { name: 'Mauritius', flag: '🇲🇺' },
  '231': { name: 'Liberia', flag: '🇱🇷' },
  '232': { name: 'Sierra Leone', flag: '🇸🇱' },
  '233': { name: 'Ghana', flag: '🇬🇭' },
  '234': { name: 'Nigeria', flag: '🇳🇬' },
  '235': { name: 'Chad', flag: '🇹🇩' },
  '236': { name: 'Central African Rep.', flag: '🇨🇫' },
  '237': { name: 'Cameroon', flag: '🇨🇲' },
  '238': { name: 'Cape Verde', flag: '🇨🇻' },
  '240': { name: 'Equatorial Guinea', flag: '🇬🇶' },
  '241': { name: 'Gabon', flag: '🇬🇦' },
  '242': { name: 'Congo', flag: '🇨🇬' },
  '243': { name: 'DR Congo', flag: '🇨🇩' },
  '244': { name: 'Angola', flag: '🇦🇴' },
  '245': { name: 'Guinea-Bissau', flag: '🇬🇼' },
  '248': { name: 'Seychelles', flag: '🇸🇨' },
  '249': { name: 'Sudan', flag: '🇸🇩' },
  '250': { name: 'Rwanda', flag: '🇷🇼' },
  '251': { name: 'Ethiopia', flag: '🇪🇹' },
  '252': { name: 'Somalia', flag: '🇸🇴' },
  '253': { name: 'Djibouti', flag: '🇩🇯' },
  '254': { name: 'Kenya', flag: '🇰🇪' },
  '255': { name: 'Tanzania', flag: '🇹🇿' },
  '256': { name: 'Uganda', flag: '🇺🇬' },
  '257': { name: 'Burundi', flag: '🇧🇮' },
  '258': { name: 'Mozambique', flag: '🇲🇿' },
  '260': { name: 'Zambia', flag: '🇿🇲' },
  '261': { name: 'Madagascar', flag: '🇲🇬' },
  '263': { name: 'Zimbabwe', flag: '🇿🇼' },
  '264': { name: 'Namibia', flag: '🇳🇦' },
  '265': { name: 'Malawi', flag: '🇲🇼' },
  '266': { name: 'Lesotho', flag: '🇱🇸' },
  '267': { name: 'Botswana', flag: '🇧🇼' },
  '268': { name: 'Eswatini', flag: '🇸🇿' },
  '269': { name: 'Comoros', flag: '🇰🇲' },
  '291': { name: 'Eritrea', flag: '🇪🇷' },
  '297': { name: 'Aruba', flag: '🇦🇼' },
  '350': { name: 'Gibraltar', flag: '🇬🇮' },
  '351': { name: 'Portugal', flag: '🇵🇹' },
  '352': { name: 'Luxembourg', flag: '🇱🇺' },
  '353': { name: 'Ireland', flag: '🇮🇪' },
  '354': { name: 'Iceland', flag: '🇮🇸' },
  '355': { name: 'Albania', flag: '🇦🇱' },
  '356': { name: 'Malta', flag: '🇲🇹' },
  '357': { name: 'Cyprus', flag: '🇨🇾' },
  '358': { name: 'Finland', flag: '🇫🇮' },
  '359': { name: 'Bulgaria', flag: '🇧🇬' },
  '370': { name: 'Lithuania', flag: '🇱🇹' },
  '371': { name: 'Latvia', flag: '🇱🇻' },
  '372': { name: 'Estonia', flag: '🇪🇪' },
  '373': { name: 'Moldova', flag: '🇲🇩' },
  '374': { name: 'Armenia', flag: '🇦🇲' },
  '375': { name: 'Belarus', flag: '🇧🇾' },
  '380': { name: 'Ukraine', flag: '🇺🇦' },
  '381': { name: 'Serbia', flag: '🇷🇸' },
  '385': { name: 'Croatia', flag: '🇭🇷' },
  '386': { name: 'Slovenia', flag: '🇸🇮' },
  '387': { name: 'Bosnia and Herzegovina', flag: '🇧🇦' },
  '389': { name: 'North Macedonia', flag: '🇲🇰' },
  '420': { name: 'Czech Republic', flag: '🇨🇿' },
  '421': { name: 'Slovakia', flag: '🇸🇰' },
  '501': { name: 'Belize', flag: '🇧🇿' },
  '502': { name: 'Guatemala', flag: '🇬🇹' },
  '503': { name: 'El Salvador', flag: '🇸🇻' },
  '504': { name: 'Honduras', flag: '🇭🇳' },
  '505': { name: 'Nicaragua', flag: '🇳🇮' },
  '506': { name: 'Costa Rica', flag: '🇨🇷' },
  '507': { name: 'Panama', flag: '🇵🇦' },
  '509': { name: 'Haiti', flag: '🇭🇹' },
  '591': { name: 'Bolivia', flag: '🇧🇴' },
  '592': { name: 'Guyana', flag: '🇬🇾' },
  '593': { name: 'Ecuador', flag: '🇪🇨' },
  '595': { name: 'Paraguay', flag: '🇵🇾' },
  '597': { name: 'Suriname', flag: '🇸🇷' },
  '598': { name: 'Uruguay', flag: '🇺🇾' },
  '673': { name: 'Brunei', flag: '🇧🇳' },
  '675': { name: 'Papua New Guinea', flag: '🇵🇬' },
  '679': { name: 'Fiji', flag: '🇫🇯' },
  '852': { name: 'Hong Kong', flag: '🇭🇰' },
  '853': { name: 'Macau', flag: '🇲🇴' },
  '855': { name: 'Cambodia', flag: '🇰🇭' },
  '856': { name: 'Laos', flag: '🇱🇦' },
  '880': { name: 'Bangladesh', flag: '🇧🇩' },
  '886': { name: 'Taiwan', flag: '🇹🇼' },
  '960': { name: 'Maldives', flag: '🇲🇻' },
  '961': { name: 'Lebanon', flag: '🇱🇧' },
  '962': { name: 'Jordan', flag: '🇯🇴' },
  '963': { name: 'Syria', flag: '🇸🇾' },
  '964': { name: 'Iraq', flag: '🇮🇶' },
  '965': { name: 'Kuwait', flag: '🇰🇼' },
  '966': { name: 'Saudi Arabia', flag: '🇸🇦' },
  '967': { name: 'Yemen', flag: '🇾🇪' },
  '968': { name: 'Oman', flag: '🇴🇲' },
  '970': { name: 'Palestine', flag: '🇵🇸' },
  '971': { name: 'UAE', flag: '🇦🇪' },
  '972': { name: 'Israel', flag: '🇮🇱' },
  '973': { name: 'Bahrain', flag: '🇧🇭' },
  '974': { name: 'Qatar', flag: '🇶🇦' },
  '975': { name: 'Bhutan', flag: '🇧🇹' },
  '976': { name: 'Mongolia', flag: '🇲🇳' },
  '977': { name: 'Nepal', flag: '🇳🇵' },
  '992': { name: 'Tajikistan', flag: '🇹🇯' },
  '993': { name: 'Turkmenistan', flag: '🇹🇲' },
  '994': { name: 'Azerbaijan', flag: '🇦🇿' },
  '995': { name: 'Georgia', flag: '🇬🇪' },
  '996': { name: 'Kyrgyzstan', flag: '🇰🇬' },
  '998': { name: 'Uzbekistan', flag: '🇺🇿' },
};

function phoneToCountry(phone: string): { name: string; flag: string } | null {
  const digits = phone.replace(/^\+/, '').replace(/^00/, '');
  for (const len of [3, 2, 1]) {
    const prefix = digits.slice(0, len);
    if (DIAL_MAP[prefix]) return DIAL_MAP[prefix];
  }
  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface LatestConversation {
  id: string;
  status: string;
  lastMessageAt: string | null;
  assignedTo: { id: string; name: string; avatarUrl: string | null } | null;
  channel: { id: string; name: string; type: string } | null;
}

function ChannelBadge({ channel }: { channel: LatestConversation['channel'] }) {
  if (!channel) return <span className="text-gray-400">—</span>;
  const type = (channel.type ?? 'WHATSAPP').toUpperCase();
  if (type === 'INSTAGRAM') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ background: 'linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7)' }}>
        <svg className="w-3 h-3 fill-current flex-shrink-0" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
        {channel.name}
      </span>
    );
  }
  if (type === 'MESSENGER' || type === 'FACEBOOK_MESSENGER') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-600 text-white">
        <svg className="w-3 h-3 fill-current flex-shrink-0" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.145 2 11.259c0 2.906 1.408 5.501 3.604 7.21V22l3.29-1.813C10.012 20.38 10.985 20.52 12 20.52c5.523 0 10-4.147 10-9.261C22 6.145 17.523 2 12 2zm1.05 12.474l-2.549-2.718-4.974 2.718 5.467-5.804 2.612 2.718 4.911-2.718-5.467 5.804z" />
        </svg>
        {channel.name}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      <svg className="w-3 h-3 fill-current flex-shrink-0" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
      {channel.name}
    </span>
  );
}

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  labels: string[];
  isBlocked: boolean;
  optedOut: boolean;
  customFields: Record<string, unknown>;
  createdAt: string;
  latestConversation: LatestConversation | null;
}

type ConvPayload = {
  id: string;
  contact: { id: string; name: string | null; phone: string; avatarUrl: string | null };
  assignedTo: null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  labels: string[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700', 'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700', 'bg-emerald-100 text-emerald-700',
];
function avatarColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(str: string) {
  return str.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}
function lifecycleLabel(c: Contact) {
  if (c.isBlocked) return { label: 'Blocked', cls: 'bg-red-100 text-red-600' };
  if (c.optedOut) return { label: 'Opted Out', cls: 'bg-gray-100 text-gray-500' };
  return { label: 'Active', cls: 'bg-green-100 text-green-700' };
}
function convStatusBadge(status: string) {
  if (status === 'OPEN') return 'bg-blue-100 text-blue-700';
  if (status === 'PENDING') return 'bg-yellow-100 text-yellow-700';
  if (status === 'RESOLVED') return 'bg-gray-100 text-gray-500';
  if (status === 'SNOOZED') return 'bg-purple-100 text-purple-600';
  return 'bg-gray-100 text-gray-500';
}

const PAGE_SIZE = 50;
const EMPTY_FORM = { name: '', phone: '', email: '', labels: '', country: '', language: '' };

// ─── Page ──────────────────────────────────────────────────────────────────
export default function ContactsPage() {
  const router = useRouter();
  const {
    conversations,
    prependConversation,
    setConversations, setStatusCounts,
  } = useInboxStore();

  // Inline chat state — local to this page so it resets on navigation
  const [activeContactConvId, setActiveContactConvId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  // Boot conversations into store so ChatWindow works
  useEffect(() => {
    conversationsApi.list({ limit: 100 }).then((res) => {
      setConversations((res.data as { data: unknown[] }).data as Parameters<typeof setConversations>[0]);
    }).catch(() => {});
    conversationsApi.getCounts().then((res) => {
      setStatusCounts(res.data as StatusCounts);
    }).catch(() => {});
  }, [setConversations, setStatusCounts]);

  const activeConversation = conversations.find((c) => c.id === activeContactConvId) ?? null;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // Segments
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [showCreateSegment, setShowCreateSegment] = useState(false);
  // CSV import
  const [showImport, setShowImport] = useState(false);
  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);
  // Filters
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterLifecycle, setFilterLifecycle] = useState<'' | 'active' | 'blocked' | 'optedOut'>('');
  const [filterLabel, setFilterLabel] = useState('');
  // Date filters
  const [dateField, setDateField] = useState<'createdAt' | 'lastMessage' | 'lastActive' | ''>('');
  const [datePreset, setDatePreset] = useState<'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom' | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Available tags from central tag system
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string; color?: string }[]>([]);

  const activeFiltersCount = [filterLifecycle, filterLabel, dateField].filter(Boolean).length;

  const load = useCallback(async (
    pg: number,
    q: string,
    segId: string | null,
    lifecycle: string,
    label: string,
    df?: string,
    dp?: string,
    dfrom?: string,
    dto?: string,
  ) => {
    setLoading(true);
    try {
      const res = await contactsApi.list({
        search: q || undefined,
        limit: PAGE_SIZE,
        page: pg,
        segmentId: segId || undefined,
        isBlocked: lifecycle === 'blocked' ? 'true' : lifecycle === 'active' ? 'false' : undefined,
        optedOut: lifecycle === 'optedOut' ? 'true' : lifecycle === 'active' ? 'false' : undefined,
        label: label || undefined,
        dateField: df || undefined,
        datePreset: dp && dp !== 'custom' ? dp : undefined,
        dateFrom: dp === 'custom' && dfrom ? dfrom : undefined,
        dateTo: dp === 'custom' && dto ? dto : undefined,
      });
      const data = res.data as { data: Contact[]; meta: { total: number } };
      setContacts(data.data);
      setTotal(data.meta.total);
    } catch (err: unknown) {
      console.error('[contacts] load error:', (err as { response?: { status?: number } })?.response?.status, err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1); setSelectedIds(new Set());
      void load(1, search, activeSegmentId, filterLifecycle, filterLabel, dateField, datePreset, dateFrom, dateTo);
    }, 300);
    return () => clearTimeout(t);
  }, [search, activeSegmentId, load, filterLifecycle, filterLabel, dateField, datePreset, dateFrom, dateTo]);

  // Load segments + available tags
  useEffect(() => {
    segmentsApi.list().then(r => setSegments(r.data ?? [])).catch(() => {});
    tagsApi.list().then(r => setAvailableTags((r.data as { id: string; name: string; color?: string }[]) ?? [])).catch(() => {});
  }, []);

  const openConversation = async (contact: Contact) => {
    try {
      const lc = contact.latestConversation;
      if (lc && lc.status !== 'RESOLVED') {
        // Non-resolved conversation exists — use the data we already have from the contacts API.
        // Always prependConversation so it's guaranteed to be in the Zustand store.
        prependConversation({
          id: lc.id,
          status: lc.status,
          lastMessageAt: lc.lastMessageAt,
          assignedTo: lc.assignedTo,
          channel: lc.channel ?? undefined,
          contact: { id: contact.id, name: contact.name, phone: contact.phone, avatarUrl: null },
          labels: [],
          unreadCount: 0,
        });
        setActiveContactConvId(lc.id);
        return;
      }
      // No conversation or resolved → findOrCreate will create/reopen one
      const res = await conversationsApi.findOrCreate(contact.id);
      const conv = res.data as ConvPayload;
      prependConversation(conv);
      setActiveContactConvId(conv.id);
    } catch { toast.error('Failed to open conversation'); }
  };

  const saveContact = async () => {
    if (!editContact && !form.phone.trim()) { toast.error('Phone is required'); return; }
    try {
      const labels = form.labels ? form.labels.split(',').map((l) => l.trim()).filter(Boolean) : [];
      const customFields: Record<string, string> = {};
      if (form.country.trim()) customFields.country = form.country.trim();
      if (form.language.trim()) customFields.language = form.language.trim();

      if (editContact) {
        await contactsApi.update(editContact.id, {
          name: form.name || undefined,
          email: form.email || undefined,
          labels,
          customFields,
        });
        toast.success('Contact updated');
        setEditContact(null);
        setContacts(cs => cs.map(c => c.id === editContact.id
          ? { ...c, name: form.name || null, email: form.email || null, labels, customFields }
          : c));
        if (selectedContact?.id === editContact.id) {
          setSelectedContact(c => c ? { ...c, name: form.name || null, email: form.email || null, labels, customFields } : c);
        }
      } else {
        await contactsApi.create({
          phone: form.phone,
          name: form.name || undefined,
          email: form.email || undefined,
          labels,
          customFields: Object.keys(customFields).length ? customFields : undefined,
        });
        toast.success('Contact created');
        setShowCreate(false);
        await load(1, search, activeSegmentId, filterLifecycle, filterLabel, dateField, datePreset, dateFrom, dateTo);
      }
      setForm(EMPTY_FORM);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed'
        : 'Failed';
      toast.error(typeof msg === 'string' ? msg : 'Failed');
    }
  };

  const confirmDelete = async () => {
    if (!deleteContact) return;
    setDeleting(true);
    try {
      await contactsApi.delete(deleteContact.id);
      toast.success('Contact deleted');
      setContacts(cs => cs.filter(c => c.id !== deleteContact.id));
      setTotal(t => Math.max(0, t - 1));
      setDeleteContact(null);
      if (selectedContact?.id === deleteContact.id) setSelectedContact(null);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to delete contact'
        : 'Failed to delete contact';
      toast.error(typeof msg === 'string' ? msg : 'Failed to delete contact');
    } finally { setDeleting(false); }
  };

  const openEdit = (c: Contact, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const cf = c.customFields as Record<string, string>;
    setForm({
      name: c.name ?? '',
      phone: c.phone,
      email: c.email ?? '',
      labels: c.labels.join(', '),
      country: cf?.country ?? '',
      language: cf?.language ?? '',
    });
    setEditContact(c);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const activeSegment = segments.find(s => s.id === activeSegmentId);
  const allOnPageSelected = contacts.length > 0 && contacts.every(c => selectedIds.has(c.id));

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds(prev => { const next = new Set(prev); contacts.forEach(c => next.delete(c.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); contacts.forEach(c => next.add(c.id)); return next; });
    }
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} contact${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkProcessing(true);
    try {
      await Promise.all([...selectedIds].map(id => contactsApi.delete(id)));
      toast.success(`Deleted ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      await load(1, search, activeSegmentId, filterLifecycle, filterLabel, dateField, datePreset, dateFrom, dateTo);
    } catch { toast.error('Failed to delete some contacts'); }
    finally { setBulkProcessing(false); }
  };

  const bulkAddTag = async () => {
    const tag = bulkTagInput.trim().toLowerCase();
    if (!tag) return;
    setBulkProcessing(true);
    try {
      await Promise.all([...selectedIds].map(id => {
        const c = contacts.find(x => x.id === id);
        const labels = [...new Set([...(c?.labels ?? []), tag])];
        return contactsApi.update(id, { labels });
      }));
      toast.success(`Tag "${tag}" added to ${selectedIds.size} contacts`);
      setShowBulkTag(false);
      setBulkTagInput('');
      await load(page, search, activeSegmentId, filterLifecycle, filterLabel, dateField, datePreset, dateFrom, dateTo);
    } catch { toast.error('Failed to add tag'); }
    finally { setBulkProcessing(false); }
  };

  const exportCsv = () => {
    const selected = contacts.filter(c => selectedIds.has(c.id));
    const rows = [
      ['Name', 'Phone', 'Email', 'Tags', 'Country', 'Language', 'Status', 'Added'],
      ...selected.map(c => {
        const cf = c.customFields as Record<string, string>;
        return [
          c.name ?? '', c.phone, c.email ?? '',
          c.labels.join(';'), cf?.country ?? '', cf?.language ?? '',
          c.optedOut ? 'opted_out' : c.isBlocked ? 'blocked' : 'active',
          new Date(c.createdAt).toISOString().split('T')[0],
        ];
      }),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'contacts-export.csv'; a.click(); URL.revokeObjectURL(url);
    toast.success(`Exported ${selected.length} contacts`);
  };

  return (
    <div className="flex h-full bg-gray-50 overflow-hidden" style={activeConversation ? { zoom: 0.8 } : undefined}>
      {/* ── LEFT: full table area (narrows when chat is open) ── */}
      <div className={cn(
        'flex overflow-hidden transition-all duration-200 flex-shrink-0',
        activeConversation ? 'w-[660px]' : 'flex-1',
      )}>
        {/* ── Segments Sidebar ── */}
      <aside className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto">
        <div className="p-3 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Segments</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          <button
            onClick={() => setActiveSegmentId(null)}
            className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors', !activeSegmentId ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-50')}
          >
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 flex-shrink-0" />
              <span>All Contacts</span>
            </div>
          </button>
          {segments.map(seg => (
            <button
              key={seg.id}
              onClick={() => setActiveSegmentId(seg.id)}
              className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors group', activeSegmentId === seg.id ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-50')}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Filter className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                <span className="truncate">{seg.name}</span>
              </div>
              <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">{seg.contactCount}</span>
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-100">
          <button
            onClick={() => setShowCreateSegment(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Segment
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{activeSegment ? activeSegment.name : 'All Contacts'}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} contacts{activeSegment ? ` · filtered by segment` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <Upload size={15} /> Import CSV
              </button>
              <button onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors">
                <Plus size={15} /> New Contact
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by name, phone or email…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-72 pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50" />
            </div>

            {/* Filter button */}
            <button
              onClick={() => setShowFilterPanel(v => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors',
                showFilterPanel || activeFiltersCount > 0
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}
            >
              <Filter size={14} />
              Filters
              {activeFiltersCount > 0 && (
                <span className="ml-0.5 bg-white/30 text-white text-[10px] font-bold px-1 rounded-full">{activeFiltersCount}</span>
              )}
            </button>

            {/* Filter panel */}
            {showFilterPanel && (
              <div className="w-full flex flex-col gap-3 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 mt-1">
                <div className="flex items-start gap-3 flex-wrap">
                  {/* Lifecycle filter */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Lifecycle</label>
                    <select value={filterLifecycle} onChange={e => setFilterLifecycle(e.target.value as typeof filterLifecycle)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 min-w-[130px]">
                      <option value="">All</option>
                      <option value="active">Active</option>
                      <option value="blocked">Blocked</option>
                      <option value="optedOut">Opted Out</option>
                    </select>
                  </div>

                  {/* Tag filter */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Tag</label>
                    <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 min-w-[130px]">
                      <option value="">All tags</option>
                      {availableTags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>

                  {/* Date field */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Date Field</label>
                    <select value={dateField} onChange={e => { setDateField(e.target.value as typeof dateField); setDatePreset(''); setDateFrom(''); setDateTo(''); }}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 min-w-[140px]">
                      <option value="">No date filter</option>
                      <option value="createdAt">Date Added</option>
                      <option value="lastMessage">Last Message</option>
                      <option value="lastActive">Last Active</option>
                    </select>
                  </div>

                  {/* Date preset — only shown when dateField is set */}
                  {dateField && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Period</label>
                      <select value={datePreset} onChange={e => setDatePreset(e.target.value as typeof datePreset)}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500 min-w-[130px]">
                        <option value="">Any time</option>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="this_week">This Week</option>
                        <option value="last_week">Last Week</option>
                        <option value="this_month">This Month</option>
                        <option value="last_month">Last Month</option>
                        <option value="custom">Custom Range</option>
                      </select>
                    </div>
                  )}

                  {/* Custom date range */}
                  {dateField && datePreset === 'custom' && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500" />
                      </div>
                    </>
                  )}

                  {/* Clear filters */}
                  {activeFiltersCount > 0 && (
                    <button onClick={() => { setFilterLifecycle(''); setFilterLabel(''); setDateField(''); setDatePreset(''); setDateFrom(''); setDateTo(''); }}
                      className="self-end text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 pb-1.5">
                      <X size={12} /> Clear all
                    </button>
                  )}
                </div>

                {/* Active filter chips */}
                {activeFiltersCount > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {filterLifecycle && (
                      <span className="inline-flex items-center gap-1 text-xs bg-white border border-teal-200 text-teal-700 rounded-full px-2.5 py-0.5 font-medium">
                        Lifecycle: {filterLifecycle}
                        <button onClick={() => setFilterLifecycle('')} className="ml-0.5 text-teal-400 hover:text-teal-700"><X size={10} /></button>
                      </span>
                    )}
                    {filterLabel && (
                      <span className="inline-flex items-center gap-1 text-xs bg-white border border-teal-200 text-teal-700 rounded-full px-2.5 py-0.5 font-medium">
                        Tag: {filterLabel}
                        <button onClick={() => setFilterLabel('')} className="ml-0.5 text-teal-400 hover:text-teal-700"><X size={10} /></button>
                      </span>
                    )}
                    {dateField && (
                      <span className="inline-flex items-center gap-1 text-xs bg-white border border-teal-200 text-teal-700 rounded-full px-2.5 py-0.5 font-medium">
                        {dateField === 'createdAt' ? 'Date Added' : dateField === 'lastMessage' ? 'Last Message' : 'Last Active'}
                        {datePreset && datePreset !== 'custom' ? `: ${datePreset.replace('_', ' ')}` : ''}
                        {datePreset === 'custom' && dateFrom ? `: ${dateFrom}` : ''}
                        {datePreset === 'custom' && dateTo ? ` → ${dateTo}` : ''}
                        <button onClick={() => { setDateField(''); setDatePreset(''); setDateFrom(''); setDateTo(''); }} className="ml-0.5 text-teal-400 hover:text-teal-700"><X size={10} /></button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bulk action toolbar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-3 py-1.5">
                <span className="text-xs font-semibold text-teal-700">{selectedIds.size} selected</span>
                <div className="w-px h-4 bg-teal-200" />
                <button onClick={() => setShowBulkTag(true)} disabled={bulkProcessing}
                  className="flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 transition-colors disabled:opacity-50">
                  <Tag size={12} /> Add Tag
                </button>
                <button onClick={exportCsv} disabled={bulkProcessing}
                  className="flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 transition-colors disabled:opacity-50">
                  <Download size={12} /> Export
                </button>
                <div className="w-px h-4 bg-teal-200" />
                <button onClick={() => { void bulkDelete(); }} disabled={bulkProcessing}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800 transition-colors disabled:opacity-50">
                  {bulkProcessing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete
                </button>
                <button onClick={() => setSelectedIds(new Set())}
                  className="text-gray-400 hover:text-gray-600 ml-1">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 w-8">
                          <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll}
                            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer" />
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Channel</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lifecycle</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tags</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Conv. Status</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assignee</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Message</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Added</th>
                        <th className="px-4 py-3 w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {contacts.length === 0 ? (
                        <tr><td colSpan={14} className="text-center py-12 text-gray-400 text-sm">No contacts found</td></tr>
                      ) : contacts.map((contact) => {
                        const displayName = contact.name ?? contact.phone;
                        const color = avatarColor(displayName);
                        const lc = lifecycleLabel(contact);
                        const conv = contact.latestConversation;
                        const cf = contact.customFields as Record<string, string>;
                        const country = cf?.country ? { name: cf.country, flag: '' } : phoneToCountry(contact.phone);
                        return (
                          <tr key={contact.id}
                            onClick={() => { void openConversation(contact); }}
                            className={cn('hover:bg-gray-50 cursor-pointer', contact.latestConversation?.id === activeContactConvId && 'bg-teal-50', selectedIds.has(contact.id) && 'bg-teal-50/60')}>
                            <td className={cn('px-4 py-3 w-8', contact.latestConversation?.id === activeContactConvId && 'border-l-2 border-l-teal-500')} onClick={(e) => toggleSelect(contact.id, e)}>
                              <input type="checkbox" checked={selectedIds.has(contact.id)} onChange={() => {}}
                                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer" />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', color)}>
                                  {initials(displayName)}
                                </div>
                                <span className="font-medium text-gray-900 max-w-[140px] truncate">
                                  {contact.name ?? <span className="text-gray-400 italic text-xs">No name</span>}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3"><ChannelBadge channel={conv?.channel ?? null} /></td>
                            <td className="px-4 py-3">
                              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', lc.cls)}>{lc.label}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px] truncate">{contact.email ?? '—'}</td>
                            <td className="px-4 py-3 text-gray-600 font-mono text-xs">{contact.phone}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1 max-w-[120px]">
                                {contact.labels.length > 0
                                  ? contact.labels.slice(0, 2).map((label) => (
                                    <span key={label} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{label}</span>
                                  ))
                                  : <span className="text-gray-400 text-xs">—</span>}
                                {contact.labels.length > 2 && <span className="text-xs text-gray-400">+{contact.labels.length - 2}</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {country
                                ? <span title={country.name}>{country.flag} {country.name}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {conv ? (
                                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', convStatusBadge(conv.status))}>
                                  {conv.status.charAt(0) + conv.status.slice(1).toLowerCase()}
                                </span>
                              ) : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{conv?.assignedTo?.name ?? '—'}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {conv?.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{formatRelativeTime(contact.createdAt)}</td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => router.push(`/contacts/${contact.id}`)} title="View profile"
                                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                  <ExternalLink size={13} />
                                </button>
                                <button onClick={() => { void openConversation(contact); }} title="Message"
                                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
                                  <MessageSquare size={13} />
                                </button>
                                <button onClick={(e) => openEdit(contact, e)} title="Edit"
                                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <Edit2 size={13} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteContact(contact); }} title="Delete"
                                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-1">
                  <p className="text-sm text-gray-500">Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); void load(p, search, activeSegmentId, filterLifecycle, filterLabel); }} disabled={page === 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const p = page <= 3 ? i + 1 : page + i - 2;
                      if (p < 1 || p > totalPages) return null;
                      return (
                        <button key={p} onClick={() => { setPage(p); void load(p, search, activeSegmentId, filterLifecycle, filterLabel); }}
                          className={cn('w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors', p === page ? 'bg-teal-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50')}>
                          {p}
                        </button>
                      );
                    })}
                    <button onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); void load(p, search, activeSegmentId, filterLifecycle, filterLabel); }} disabled={page === totalPages}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>{/* end LEFT panel */}

      {/* ── CENTER + RIGHT: inline chat (opens when contact row is clicked) ── */}
      {activeConversation && (
        <>
          <ChatWindow
            conversation={activeConversation}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((v) => !v)}
            onClose={() => setActiveContactConvId(null)}
          />
          {showDetails && <ConversationDetails conversation={activeConversation} />}
        </>
      )}

      {/* Create / Edit modal */}
      {(showCreate || editContact) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowCreate(false); setEditContact(null); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editContact ? 'Edit Contact' : 'New Contact'}</h2>
              <button onClick={() => { setShowCreate(false); setEditContact(null); }}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              {([
                { label: 'Name', key: 'name', type: 'text', placeholder: 'e.g. Kofi Mensah', disabled: false },
                { label: 'Phone Number *', key: 'phone', type: 'tel', placeholder: '+233501234567', disabled: !!editContact },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'email@example.com', disabled: false },
                { label: 'Country', key: 'country', type: 'text', placeholder: 'e.g. Ghana', disabled: false },
                { label: 'Language', key: 'language', type: 'text', placeholder: 'e.g. English', disabled: false },
              ] as { label: string; key: keyof typeof form; type: string; placeholder: string; disabled: boolean }[]).map(({ label, key, type, placeholder, disabled }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    value={form[key]}
                    disabled={disabled}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveContact(); }}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              ))}
              {/* Tag picker */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Tags</label>
                {(() => {
                  const selected = form.labels ? form.labels.split(',').map(s => s.trim()).filter(Boolean) : [];
                  const toggle = (name: string) => setForm(f => {
                    const cur = f.labels ? f.labels.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const next = cur.includes(name) ? cur.filter(t => t !== name) : [...cur, name];
                    return { ...f, labels: next.join(', ') };
                  });
                  return (
                    <>
                      <div className={cn(
                        'w-full min-h-[42px] px-3 py-2 border border-gray-200 rounded-xl flex flex-wrap gap-1.5 items-center',
                        selected.length === 0 && 'text-gray-400',
                      )}>
                        {selected.length === 0 && <span className="text-sm">No tags selected</span>}
                        {selected.map(tag => (
                          <span key={tag} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                            {tag}
                            <button type="button" onClick={() => toggle(tag)} className="text-teal-500 hover:text-teal-700 leading-none">
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                      {availableTags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {availableTags.map(tag => {
                            const isSelected = selected.includes(tag.name);
                            return (
                              <button key={tag.id} type="button" onClick={() => toggle(tag.name)}
                                className={cn(
                                  'text-xs px-2.5 py-1 rounded-full border transition-colors',
                                  isSelected
                                    ? 'bg-teal-100 text-teal-700 border-teal-300'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300 hover:text-teal-600',
                                )}>
                                {isSelected && '✓ '}{tag.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => { setShowCreate(false); setEditContact(null); }} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Cancel</button>
              <button onClick={() => { void saveContact(); }} className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium">
                {editContact ? 'Save Changes' : 'Create Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteContact && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteContact(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Delete Contact</h3>
                <p className="text-sm text-gray-500">This will also delete all conversations</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Delete <span className="font-semibold">{deleteContact.name ?? deleteContact.phone}</span>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteContact(null)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Cancel</button>
              <button onClick={() => { void confirmDelete(); }} disabled={deleting}
                className="flex-1 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-60 font-medium">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportModal
          onClose={() => setShowImport(false)}
          onDone={(count) => { toast.success(`Imported ${count} contacts`); void load(1, search, activeSegmentId, filterLifecycle, filterLabel); }}
        />
      )}

      {showCreateSegment && (
        <CreateSegmentModal
          onClose={() => setShowCreateSegment(false)}
          onCreated={(seg) => { setSegments(prev => [...prev, seg]); setActiveSegmentId(seg.id); }}
        />
      )}

      {/* Bulk Add Tag Modal */}
      {showBulkTag && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowBulkTag(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Tag size={18} className="text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Add Tag to {selectedIds.size} contacts</h3>
                <p className="text-xs text-gray-500">Tag will be added to existing tags</p>
              </div>
            </div>
            <input
              type="text"
              placeholder="e.g. vip, lead, customer"
              value={bulkTagInput}
              onChange={e => setBulkTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { void bulkAddTag(); } }}
              autoFocus
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowBulkTag(false)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Cancel</button>
              <button onClick={() => { void bulkAddTag(); }} disabled={bulkProcessing || !bulkTagInput.trim()}
                className="flex-1 py-2.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-60 font-medium flex items-center justify-center gap-2">
                {bulkProcessing && <Loader2 size={14} className="animate-spin" />}
                Add Tag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contact Card ──────────────────────────────────────────────────────────
type RecentMessage = { id: string; direction: string; type: string; content: string | null; mediaCaption: string | null; createdAt: string };

function ContactCard({
  contact, onClose, onMessage, onEdit, onDelete,
}: {
  contact: Contact;
  onClose: () => void;
  onMessage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const displayName = contact.name ?? contact.phone;
  const color = avatarColor(displayName);
  const lc = lifecycleLabel(contact);
  const conv = contact.latestConversation;
  const cf = contact.customFields as Record<string, string>;
  const country = cf?.country ? { name: cf.country, flag: '' } : phoneToCountry(contact.phone);

  const [recentMsgs, setRecentMsgs] = useState<RecentMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    if (!conv?.id) return;
    setLoadingMsgs(true);
    messagesApi.list(conv.id, { limit: 8, page: 1 })
      .then(r => {
        const data = (r.data as { data: RecentMessage[] }).data ?? [];
        setRecentMsgs(data.slice(-8).reverse());
      })
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  }, [conv?.id]);

  const Row = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-6 flex items-center justify-center text-gray-400 flex-shrink-0 mt-0.5">
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        <div className="text-sm text-gray-800 font-medium">{value}</div>
      </div>
    </div>
  );

  const now = Date.now();
  const lastMsgMs = conv?.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : null;
  const waActive = lastMsgMs ? (now - lastMsgMs) < 24 * 60 * 60 * 1000 : false;
  const mauActive = lastMsgMs ? (now - lastMsgMs) < 30 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="w-80 border-l border-gray-100 bg-white flex flex-col flex-shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
        <h3 className="font-semibold text-gray-900">Contact Card</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16} /></button>
      </div>

      <div className="flex flex-col items-center py-6 px-5 border-b border-gray-100">
        <div className={cn('w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-3', color)}>
          {initials(displayName)}
        </div>
        <p className="font-semibold text-gray-900 text-base text-center">
          {contact.name ?? <span className="text-gray-400 italic">No name</span>}
        </p>
        <p className="text-sm text-gray-500 mt-0.5 font-mono">{contact.phone}</p>
        {contact.email && <p className="text-xs text-gray-400 mt-0.5">{contact.email}</p>}
        <div className="mt-3">
          <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', lc.cls)}>{lc.label}</span>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-gray-100 grid grid-cols-3 gap-2">
        <button onClick={onMessage}
          className="flex flex-col items-center gap-1.5 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors">
          <MessageSquare size={16} />
          <span className="text-xs font-medium">Message</span>
        </button>
        <button onClick={onEdit}
          className="flex flex-col items-center gap-1.5 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors">
          <Edit2 size={16} />
          <span className="text-xs font-medium">Edit</span>
        </button>
        <button onClick={onDelete}
          className="flex flex-col items-center gap-1.5 py-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors">
          <Trash2 size={16} />
          <span className="text-xs font-medium">Delete</span>
        </button>
      </div>

      <div className="px-5 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Contact Details</p>
        <Row icon={Phone} label="Phone" value={contact.phone} />
        <Row icon={Mail} label="Email" value={contact.email ?? '—'} />
        <Row icon={Globe} label="Country" value={
          country ? <span>{country.flag} {country.name}</span> : '—'
        } />
        <Row icon={Languages} label="Language" value={cf?.language ?? '—'} />
        <Row icon={Calendar} label="Date Added" value={new Date(contact.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} />
        {contact.labels.length > 0 && (
          <div className="flex items-start gap-3 py-2.5">
            <div className="w-6 flex items-center justify-center text-gray-400 flex-shrink-0 mt-0.5">
              <Tag size={13} />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1">
                {contact.labels.map((l) => <span key={l} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{l}</span>)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Conversation Info</p>
        <Row icon={AlertCircle} label="Status" value={
          conv ? (
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', convStatusBadge(conv.status))}>
              {conv.status.charAt(0) + conv.status.slice(1).toLowerCase()}
            </span>
          ) : '—'
        } />
        <Row icon={Wifi} label="Channel" value={conv?.channel?.name ?? '—'} />
        <Row icon={User} label="Assignee" value={conv?.assignedTo?.name ?? 'Unassigned'} />
        <Row icon={MessageSquare} label="Last Message" value={conv?.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : '—'} />
        <Row icon={Wifi} label="WA Conversation" value={
          <span className={waActive ? 'text-green-600' : 'text-gray-400'}>
            {waActive ? 'Active' : 'Inactive'}
          </span>
        } />
        <Row icon={User} label="MAU Status" value={
          <span className={mauActive ? 'text-green-600' : 'text-gray-400'}>
            {mauActive ? 'Active' : 'Inactive'}
          </span>
        } />
        <Row icon={AlertCircle} label="Incoming" value={
          <span className={contact.isBlocked ? 'text-red-500' : 'text-green-600'}>
            {contact.isBlocked ? 'Blocked' : 'Allowed'}
          </span>
        } />
        <Row icon={AlertCircle} label="Opted In" value={
          <span className={contact.optedOut ? 'text-red-500' : 'text-green-600'}>
            {contact.optedOut ? 'No' : 'Yes'}
          </span>
        } />
      </div>

      {conv && (
        <div className="px-5 py-3 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent Messages</p>
          {loadingMsgs ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={14} className="animate-spin text-gray-300" />
            </div>
          ) : recentMsgs.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No messages on record</p>
          ) : (
            <div className="space-y-2">
              {recentMsgs.map(msg => {
                const isOut = msg.direction === 'OUTBOUND';
                const preview = msg.content ?? msg.mediaCaption ?? `📎 ${msg.type.charAt(0) + msg.type.slice(1).toLowerCase()}`;
                return (
                  <div key={msg.id} className={cn('flex gap-2 items-start', isOut ? 'flex-row-reverse' : 'flex-row')}>
                    <div className={cn(
                      'text-xs px-2.5 py-1.5 rounded-2xl max-w-[200px] leading-relaxed',
                      isOut ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm',
                    )}>
                      <p className="break-words line-clamp-3">{preview}</p>
                      <p className={cn('text-[10px] mt-0.5 opacity-60', isOut ? 'text-right' : 'text-left')}>
                        {formatRelativeTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={onMessage}
            className="w-full mt-3 py-2 text-xs font-medium text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-xl transition-colors border border-teal-100">
            Open full conversation →
          </button>
        </div>
      )}
    </div>
  );
}
