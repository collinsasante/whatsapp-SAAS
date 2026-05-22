'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Plus, Search, X, Eye, Trash2, Send, FileText, ChevronDown,
  Type, Image, Video, FileIcon, Phone, Link2, MessageSquare, AlignLeft,
  Check, ArrowLeft, Loader2, Copy, MoreVertical, ExternalLink,
} from 'lucide-react';
import { templatesApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { cn, formatRelativeTime } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────
interface TemplateButton { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }
interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
  text?: string;
  buttons?: TemplateButton[];
  example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] };
}
interface Template {
  id: string; name: string; language: string; category: string;
  status: string; components: TemplateComponent[]; createdAt: string; waTemplateId?: string;
}
interface BuilderState {
  name: string; language: string; category: string;
  headerType: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  headerText: string; headerExample: string;
  body: string; bodyExamples: string[];
  footer: string;
  buttons: TemplateButton[];
}

// ─── constants ────────────────────────────────────────────────────────────────
const LANGUAGES: Record<string, string> = {
  'en': 'English', 'en_US': 'English (US)', 'en_GB': 'English (UK)',
  'hi': 'Hindi', 'ar': 'Arabic', 'es': 'Spanish', 'es_ES': 'Spanish (Spain)',
  'pt_BR': 'Portuguese (BR)', 'fr': 'French', 'de': 'German',
  'it': 'Italian', 'id': 'Indonesian', 'ms': 'Malay', 'nl': 'Dutch',
  'ru': 'Russian', 'tr': 'Turkish', 'zh_CN': 'Chinese (Simplified)',
};
const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const STATUS_META: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Approved', cls: 'bg-green-100 text-green-700' },
  PENDING:  { label: 'Pending',  cls: 'bg-yellow-100 text-yellow-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  PAUSED:   { label: 'Paused',   cls: 'bg-gray-100 text-gray-500' },
  DRAFT:    { label: 'Draft',    cls: 'bg-blue-100 text-blue-600' },
};

// ─── helpers ──────────────────────────────────────────────────────────────────
function highlightVars(text: string) {
  return text.split(/({{[\d]+}})/g).map((part, i) =>
    /^{{[\d]+}}$/.test(part)
      ? <span key={i} className="bg-teal-100 text-teal-700 rounded px-1 font-mono text-[11px]">{part}</span>
      : <span key={i}>{part}</span>
  );
}

function countVars(text: string): number {
  const matches = text.match(/{{[\d]+}}/g);
  if (!matches) return 0;
  const nums = matches.map(m => parseInt(m.replace(/[{}]/g, '')));
  return Math.max(...nums, 0);
}

function builderToComponents(b: BuilderState): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  if (b.headerType !== 'NONE') {
    const comp: TemplateComponent = { type: 'HEADER', format: b.headerType };
    if (b.headerType === 'TEXT') {
      comp.text = b.headerText;
      if (b.headerExample) comp.example = { header_text: [b.headerExample] };
    } else {
      comp.example = { header_handle: [b.headerExample || 'https://example.com/media.jpg'] };
    }
    components.push(comp);
  }
  if (b.body) {
    const comp: TemplateComponent = { type: 'BODY', text: b.body };
    const varCount = countVars(b.body);
    if (varCount > 0) {
      comp.example = { body_text: [b.bodyExamples.slice(0, varCount)] };
    }
    components.push(comp);
  }
  if (b.footer) components.push({ type: 'FOOTER', text: b.footer });
  if (b.buttons.length > 0) components.push({ type: 'BUTTONS', buttons: b.buttons });
  return components;
}

// ─── Phone Preview ────────────────────────────────────────────────────────────
function PhonePreview({ b, examples }: { b: BuilderState; examples: Record<string, string> }) {
  const bodyWithExamples = b.body.replace(/{{(\d+)}}/g, (_, n) => examples[n] || `{{${n}}}`);
  const headerWithExample = b.headerText.replace(/{{(\d+)}}/g, (_, n) => examples[n] || `{{${n}}}`);

  return (
    <div className="flex flex-col h-full">
      {/* Phone frame */}
      <div className="mx-auto w-[280px]">
        <div className="bg-gray-800 rounded-[36px] p-3 shadow-2xl">
          <div className="bg-[#e5ddd5] rounded-[28px] overflow-hidden min-h-[480px] flex flex-col">
            {/* Status bar */}
            <div className="bg-teal-700 px-4 py-2 flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-white text-xs font-semibold">{b.name || 'Your Business'}</p>
                <p className="text-teal-200 text-[10px]">Business Account</p>
              </div>
            </div>
            {/* Chat area */}
            <div className="flex-1 p-3 flex flex-col justify-end">
              <div className="bg-white rounded-xl rounded-tl-none shadow-sm overflow-hidden max-w-[95%]">
                {/* Header */}
                {b.headerType !== 'NONE' && (
                  <div>
                    {b.headerType === 'TEXT' && b.headerText && (
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-xs font-bold text-gray-900">{headerWithExample}</p>
                      </div>
                    )}
                    {b.headerType === 'IMAGE' && (
                      <div className="h-28 bg-gradient-to-br from-teal-100 to-teal-200 flex items-center justify-center">
                        <Image className="w-8 h-8 text-teal-400" />
                        <span className="text-teal-500 text-xs ml-1">Image</span>
                      </div>
                    )}
                    {b.headerType === 'VIDEO' && (
                      <div className="h-28 bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
                        <Video className="w-8 h-8 text-purple-400" />
                        <span className="text-purple-500 text-xs ml-1">Video</span>
                      </div>
                    )}
                    {b.headerType === 'DOCUMENT' && (
                      <div className="h-16 bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center gap-2">
                        <FileIcon className="w-6 h-6 text-orange-400" />
                        <span className="text-orange-500 text-xs">Document</span>
                      </div>
                    )}
                  </div>
                )}
                {/* Body */}
                {b.body && (
                  <div className="px-3 py-2">
                    <p className="text-[11px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {highlightVars(bodyWithExamples)}
                    </p>
                  </div>
                )}
                {/* Footer */}
                {b.footer && (
                  <div className="px-3 pb-1">
                    <p className="text-[10px] text-gray-400">{b.footer}</p>
                  </div>
                )}
                {/* Timestamp */}
                <div className="px-3 pb-2 flex justify-end">
                  <p className="text-[9px] text-gray-400">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                  </p>
                </div>
                {/* Buttons */}
                {b.buttons.length > 0 && (
                  <div className="border-t border-gray-100">
                    {b.buttons.map((btn, i) => (
                      <div key={i} className={`flex items-center justify-center gap-1 px-3 py-2 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                        {btn.type === 'URL' ? <ExternalLink className="w-3 h-3 text-teal-600 flex-shrink-0" /> : btn.type === 'PHONE_NUMBER' ? <Phone className="w-3 h-3 text-teal-600 flex-shrink-0" /> : <span className="text-teal-600 flex-shrink-0 text-[11px]">↩</span>}
                        <span className="text-[11px] text-teal-600 font-medium truncate">{btn.text || 'Button'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Template Builder ─────────────────────────────────────────────────────────
const EMPTY_BUILDER: BuilderState = {
  name: '', language: 'en', category: 'MARKETING',
  headerType: 'NONE', headerText: '', headerExample: '',
  body: '', bodyExamples: [], footer: '', buttons: [],
};

function TemplateBuilder({ initial, onSave, onBack }: {
  initial?: Template;
  onSave: (template: Template) => void;
  onBack: () => void;
}) {
  const [b, setB] = useState<BuilderState>(() => {
    if (!initial) return EMPTY_BUILDER;
    const comps = initial.components;
    const header = comps.find(c => c.type === 'HEADER');
    const body = comps.find(c => c.type === 'BODY');
    const footer = comps.find(c => c.type === 'FOOTER');
    const buttons = comps.find(c => c.type === 'BUTTONS');
    return {
      name: initial.name,
      language: initial.language,
      category: initial.category,
      headerType: (header?.format ?? 'NONE') as BuilderState['headerType'],
      headerText: header?.text ?? '',
      headerExample: header?.example?.header_text?.[0] ?? '',
      body: body?.text ?? '',
      bodyExamples: body?.example?.body_text?.[0] ?? [],
      footer: footer?.text ?? '',
      buttons: (buttons?.buttons ?? []) as TemplateButton[],
    };
  });

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [examples, setExamples] = useState<Record<string, string>>({});

  const set = useCallback(<K extends keyof BuilderState>(k: K, v: BuilderState[K]) => {
    setB(p => ({ ...p, [k]: v }));
  }, []);

  const bodyVarCount = countVars(b.body);

  const insertVar = () => {
    const next = bodyVarCount + 1;
    set('body', b.body + `{{${next}}}`);
    setB(p => ({ ...p, bodyExamples: [...p.bodyExamples, ''] }));
  };

  const addButton = (type: TemplateButton['type']) => {
    if (b.buttons.length >= 3) return;
    set('buttons', [...b.buttons, { type, text: '' }]);
  };

  const removeButton = (i: number) => {
    set('buttons', b.buttons.filter((_, j) => j !== i));
  };

  const updateButton = (i: number, data: Partial<TemplateButton>) => {
    set('buttons', b.buttons.map((btn, j) => j === i ? { ...btn, ...data } : btn));
  };

  const validate = (): string | null => {
    if (!b.name.trim()) return 'Template name is required';
    if (!/^[a-z0-9_]+$/.test(b.name)) return 'Name must be lowercase letters, numbers, underscores only';
    if (!b.body.trim()) return 'Body text is required';
    if (bodyVarCount > 0 && b.bodyExamples.some(e => !e?.trim())) return 'Fill in sample values for all variables';
    // Meta rule: variables cannot be at the start or end of the body
    if (/^\s*\{\{/.test(b.body)) return 'Body text cannot start with a variable like {{1}}. Add some text before it, e.g. "Hello {{1}}"';
    if (/\}\}\s*$/.test(b.body)) return 'Body text cannot end with a variable like {{1}}. Add some text after it, e.g. "{{1}} has been confirmed."';
    const phoneBtn = b.buttons.find(btn => btn.type === 'PHONE_NUMBER');
    if (phoneBtn && !/^\+\d{7,15}$/.test(phoneBtn.phone_number ?? '')) return 'Phone number must be in E.164 format, e.g. +966534342217';
    return null;
  };

  const handleSave = async (andSubmit = false) => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setSaving(true);
    try {
      const components = builderToComponents({ ...b, bodyExamples: b.bodyExamples });
      let result: Template;
      if (initial) {
        const r = await templatesApi.update(initial.id, { name: b.name, language: b.language, category: b.category, components });
        result = r.data as Template;
      } else {
        const r = await templatesApi.create({ name: b.name, language: b.language, category: b.category, components });
        result = r.data as Template;
      }
      if (andSubmit) {
        setSubmitting(true);
        try {
          const sr = await templatesApi.submit(result.id);
          result = sr.data as Template;
          toast.success('Template submitted to Meta for approval!');
        } catch (e: unknown) {
          const raw = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
          const msg = typeof raw === 'string' && raw.toLowerCase().includes('not configured')
            ? 'WhatsApp Business API not connected. Go to Settings → Channels to configure.'
            : (raw || 'Submit to Meta failed');
          toast.error(msg, { duration: 5000 });
        } finally {
          setSubmitting(false);
        }
      } else {
        toast.success(initial ? 'Template updated' : 'Template saved as draft');
      }
      onSave(result);
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Builder form */}
      <div className="flex-1 overflow-y-auto bg-white border-r border-gray-200">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
          <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <h2 className="text-base font-bold text-gray-900">{initial ? 'Edit Template' : 'Create Template'}</h2>
            <p className="text-xs text-gray-400">Build your WhatsApp message template</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void handleSave(false); }}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Draft'}
            </button>
            <button
              onClick={() => { void handleSave(true); }}
              disabled={saving || submitting}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit for Approval
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-w-2xl">
          {/* Basic info */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-5 h-5 bg-teal-100 text-teal-600 rounded-full text-xs flex items-center justify-center font-bold">1</span>
              Basic Information
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Template Name</label>
                <input
                  value={b.name}
                  onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  placeholder="order_confirmation"
                  disabled={!!initial}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">Lowercase, numbers, underscores only. Cannot be changed after approval.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
                <select value={b.language} onChange={e => set('language', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none">
                  {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <div className="flex gap-2">
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => set('category', cat)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${b.category === cat ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'}`}>
                    {cat}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {b.category === 'MARKETING' && 'Promotional messages — requires opt-in from customers.'}
                {b.category === 'UTILITY' && 'Transactional messages like order updates, receipts, alerts.'}
                {b.category === 'AUTHENTICATION' && 'OTP and verification codes only.'}
              </p>
            </div>
          </section>

          {/* Header */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-5 h-5 bg-teal-100 text-teal-600 rounded-full text-xs flex items-center justify-center font-bold">2</span>
              Header <span className="text-gray-400 font-normal text-xs">(Optional)</span>
            </h3>
            <div className="flex gap-2 flex-wrap">
              {(['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const).map(ht => (
                <button key={ht} onClick={() => set('headerType', ht)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${b.headerType === ht ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'}`}>
                  {ht === 'TEXT' && <Type className="w-3.5 h-3.5" />}
                  {ht === 'IMAGE' && <Image className="w-3.5 h-3.5" />}
                  {ht === 'VIDEO' && <Video className="w-3.5 h-3.5" />}
                  {ht === 'DOCUMENT' && <FileIcon className="w-3.5 h-3.5" />}
                  {ht}
                </button>
              ))}
            </div>
            {b.headerType === 'TEXT' && (
              <div className="space-y-2">
                <input value={b.headerText} onChange={e => set('headerText', e.target.value)}
                  placeholder="Your header text (max 60 chars, 1 variable allowed)"
                  maxLength={60}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {countVars(b.headerText) > 0 && (
                  <input value={b.headerExample} onChange={e => set('headerExample', e.target.value)}
                    placeholder="Sample value for {{1}}"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                )}
              </div>
            )}
            {(b.headerType === 'IMAGE' || b.headerType === 'VIDEO' || b.headerType === 'DOCUMENT') && (
              <input value={b.headerExample} onChange={e => set('headerExample', e.target.value)}
                placeholder={`Sample ${b.headerType.toLowerCase()} URL for review`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            )}
          </section>

          {/* Body */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-5 h-5 bg-teal-100 text-teal-600 rounded-full text-xs flex items-center justify-center font-bold">3</span>
              Body <span className="text-red-400 text-xs">*</span>
            </h3>
            <div className="relative">
              <textarea
                value={b.body}
                onChange={e => set('body', e.target.value)}
                rows={5}
                placeholder="Enter your message body. Use *bold*, _italic_, ~strikethrough~. Add variables with the button below."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              />
              <div className="flex items-center justify-between mt-1">
                <button onClick={insertVar}
                  className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-1 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Variable {bodyVarCount > 0 && `({{${bodyVarCount + 1}}})`}
                </button>
                <span className="text-xs text-gray-400">{b.body.length}/1024</span>
              </div>
            </div>
            {/* Variable sample values */}
            {bodyVarCount > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-amber-700">Sample values for variables (required by Meta)</p>
                {Array.from({ length: bodyVarCount }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded flex-shrink-0">{`{{${i + 1}}}`}</span>
                    <input
                      value={b.bodyExamples[i] ?? ''}
                      onChange={e => {
                        const ex = [...b.bodyExamples];
                        ex[i] = e.target.value;
                        set('bodyExamples', ex);
                      }}
                      placeholder={`Sample value ${i + 1}`}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                ))}
              </div>
            )}
            {/* Variable examples for preview */}
            {bodyVarCount > 0 && (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium">Preview with: </span>
                {Array.from({ length: bodyVarCount }, (_, i) => (
                  <span key={i} className="inline-flex items-center gap-1 mr-2">
                    <span className="font-mono bg-teal-100 text-teal-700 px-1 rounded">{`{{${i + 1}}}`}</span>
                    <input
                      value={examples[String(i + 1)] ?? ''}
                      onChange={e => setExamples(p => ({ ...p, [String(i + 1)]: e.target.value }))}
                      placeholder={b.bodyExamples[i] || `value${i + 1}`}
                      className="w-20 bg-white border border-gray-200 rounded px-1.5 text-xs focus:outline-none"
                    />
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Footer */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-5 h-5 bg-teal-100 text-teal-600 rounded-full text-xs flex items-center justify-center font-bold">4</span>
              Footer <span className="text-gray-400 font-normal text-xs">(Optional)</span>
            </h3>
            <input value={b.footer} onChange={e => set('footer', e.target.value)}
              placeholder="Unsubscribe · www.yourcompany.com"
              maxLength={60}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </section>

          {/* Buttons */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-5 h-5 bg-teal-100 text-teal-600 rounded-full text-xs flex items-center justify-center font-bold">5</span>
              Buttons <span className="text-gray-400 font-normal text-xs">(Up to 3)</span>
            </h3>
            {b.buttons.map((btn, i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${btn.type === 'QUICK_REPLY' ? 'bg-blue-100 text-blue-700' : btn.type === 'URL' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                    {btn.type === 'URL' ? <ExternalLink className="w-3 h-3" /> : btn.type === 'PHONE_NUMBER' ? '📞' : '↩'}
                    {btn.type === 'QUICK_REPLY' ? 'Quick Reply' : btn.type === 'URL' ? 'Visit Website' : 'Call Phone'}
                  </span>
                  <button onClick={() => removeButton(i)} className="text-gray-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input value={btn.text} onChange={e => updateButton(i, { text: e.target.value })}
                  placeholder="Button label" maxLength={20}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-teal-500" />
                {btn.type === 'URL' && (
                  <input value={btn.url ?? ''} onChange={e => updateButton(i, { url: e.target.value })}
                    placeholder="https://yoursite.com/page"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-1 focus:ring-teal-500" />
                )}
                {btn.type === 'PHONE_NUMBER' && (
                  <div>
                    <input value={btn.phone_number ?? ''} onChange={e => updateButton(i, { phone_number: e.target.value })}
                      placeholder="+966534342217"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-1 focus:ring-teal-500" />
                    <p className="text-[10px] text-amber-600 mt-0.5">Must include country code, e.g. +966 for Saudi Arabia</p>
                  </div>
                )}
              </div>
            ))}
            {b.buttons.length < 3 && (
              <div className="flex gap-2">
                <button onClick={() => addButton('QUICK_REPLY')}
                  className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-teal-400 hover:text-teal-600 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Quick Reply
                </button>
                <button onClick={() => addButton('URL')}
                  disabled={b.buttons.some(btn => btn.type === 'URL')}
                  className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-teal-400 hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <Link2 className="w-3.5 h-3.5" /> Visit Website
                </button>
                <button onClick={() => addButton('PHONE_NUMBER')}
                  disabled={b.buttons.some(btn => btn.type === 'PHONE_NUMBER')}
                  className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-teal-400 hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <Phone className="w-3.5 h-3.5" /> Call Phone
                </button>
              </div>
            )}
            {b.buttons.length > 0 && (
              <p className="text-[10px] text-gray-400">Buttons appear below the message. Quick Reply and CTA buttons cannot be mixed after 2 buttons.</p>
            )}
          </section>
        </div>
      </div>

      {/* Preview panel */}
      <div className="w-80 bg-gray-50 border-l border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200 bg-white">
          <p className="text-sm font-semibold text-gray-700">Live Preview</p>
          <p className="text-xs text-gray-400">Updates as you type</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex items-start justify-center pt-8">
          <PhonePreview b={b} examples={examples} />
        </div>
      </div>
    </div>
  );
}

// ─── Template Card (list view) ────────────────────────────────────────────────
function TemplateCard({ template, onPreview, onEdit, onDelete }: {
  template: Template;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const body = template.components.find(c => c.type === 'BODY');
  const header = template.components.find(c => c.type === 'HEADER');
  const buttons = template.components.find(c => c.type === 'BUTTONS');
  const status = STATUS_META[template.status] ?? { label: template.status, cls: 'bg-gray-100 text-gray-500' };

  return (
    <div className="bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow group">
      {/* Header preview strip */}
      <div className="bg-[#e5ddd5] px-4 py-3 min-h-[80px] flex items-center justify-center cursor-pointer rounded-t-xl overflow-hidden" onClick={onPreview}>
        <div className="bg-white rounded-lg p-2.5 w-full max-w-[200px] shadow-sm">
          {header?.format === 'IMAGE' && (
            <div className="h-12 bg-teal-100 rounded flex items-center justify-center mb-1.5">
              <Image className="w-4 h-4 text-teal-400" />
            </div>
          )}
          {header?.text && <p className="text-[10px] font-bold text-gray-900 mb-1 truncate">{header.text}</p>}
          {body?.text && <p className="text-[10px] text-gray-600 line-clamp-2 leading-relaxed">{body.text.replace(/{{[\d]+}}/g, '...')}</p>}
          {buttons?.buttons && (
            <div className="mt-1.5 pt-1.5 border-t border-gray-100">
              {buttons.buttons.slice(0, 2).map((btn, i) => (
                <p key={i} className="text-[9px] text-teal-600 text-center">{btn.text}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <h3 className="font-semibold text-gray-900 text-xs font-mono truncate">{template.name}</h3>
          <div className="relative flex-shrink-0">
            <button onClick={() => setMenuOpen(v => !v)} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-5 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 w-32">
                <button onClick={() => { onPreview(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                <button onClick={() => { onEdit(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                  <FileText className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => { onDelete(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', status.cls)}>{status.label}</span>
          <span className="text-[10px] text-gray-400">{template.language}</span>
          <span className="text-[10px] text-gray-400">{template.category}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">{formatRelativeTime(template.createdAt)}</p>
      </div>
    </div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────
function PreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const body = template.components.find(c => c.type === 'BODY');
  const b: BuilderState = {
    name: template.name, language: template.language, category: template.category,
    headerType: (template.components.find(c => c.type === 'HEADER')?.format ?? 'NONE') as BuilderState['headerType'],
    headerText: template.components.find(c => c.type === 'HEADER')?.text ?? '',
    headerExample: '',
    body: body?.text ?? '',
    bodyExamples: [],
    footer: template.components.find(c => c.type === 'FOOTER')?.text ?? '',
    buttons: (template.components.find(c => c.type === 'BUTTONS')?.buttons ?? []) as TemplateButton[],
  };
  const status = STATUS_META[template.status] ?? { label: template.status, cls: 'bg-gray-100 text-gray-500' };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-bold text-gray-900 font-mono text-sm">{template.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', status.cls)}>{status.label}</span>
                <span className="text-xs text-gray-500">{template.language} · {template.category}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Preview</p>
            <PhonePreview b={b} examples={{}} />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Components</p>
            {template.components.map((comp, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">{comp.type}{comp.format ? ` · ${comp.format}` : ''}</span>
                {comp.text && <p className="text-xs text-gray-700">{highlightVars(comp.text)}</p>}
                {comp.buttons?.map((btn, j) => (
                  <div key={j} className="mt-1.5 flex items-center gap-2 text-xs bg-white border border-gray-200 px-2 py-1.5 rounded-lg">
                    <span className="text-gray-400 text-[10px] uppercase w-14 flex-shrink-0">{btn.type}</span>
                    <span className="font-medium text-gray-800">{btn.text}</span>
                    {btn.url && <span className="text-teal-600 truncate text-[10px]">{btn.url}</span>}
                    {btn.phone_number && <span className="text-gray-500">{btn.phone_number}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [preview, setPreview] = useState<Template | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editTarget, setEditTarget] = useState<Template | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await templatesApi.list({ limit: 200 });
      setTemplates((res.data as { data: Template[] }).data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await load();
      try { await templatesApi.sync(); await load(); } catch { /* silent background sync */ }
    };
    void init();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await templatesApi.sync();
      await load();
      toast.success('Templates synced from WhatsApp');
    } catch {
      toast.error('Sync failed — check your WhatsApp API credentials');
    } finally { setSyncing(false); }
  };

  const handleDelete = async (template: Template) => {
    if (!confirm(`Delete "${template.name}"? This will also remove it from Meta if approved.`)) return;
    try {
      await templatesApi.deleteWithMeta(template.id);
      setTemplates(prev => prev.filter(t => t.id !== template.id));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleSaved = (template: Template) => {
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.id === template.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = template; return next; }
      return [template, ...prev];
    });
    setView('list');
  };

  const filtered = useMemo(() => templates.filter(t => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const bodyText = t.components.find(c => c.type === 'BODY')?.text ?? '';
      return t.name.toLowerCase().includes(q) || bodyText.toLowerCase().includes(q);
    }
    return true;
  }), [templates, search, statusFilter, categoryFilter]);

  const countByStatus = (s: string) => templates.filter(t => t.status === s).length;

  // Show builder
  if (view === 'create' || view === 'edit') {
    return (
      <div className="flex flex-col h-full">
        <TemplateBuilder
          initial={view === 'edit' ? editTarget ?? undefined : undefined}
          onSave={handleSaved}
          onBack={() => setView('list')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Message Templates</h1>
            <p className="text-sm text-gray-500">Create and manage WhatsApp-approved templates</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { void sync(); }} disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <button onClick={() => { setEditTarget(null); setView('create'); }}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
              <Plus size={16} /> Create Template
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4">
        {[
          { label: 'Total',    value: templates.length,           cls: 'text-gray-900' },
          { label: 'Approved', value: countByStatus('APPROVED'),  cls: 'text-green-600' },
          { label: 'Pending',  value: countByStatus('PENDING'),   cls: 'text-yellow-600' },
          { label: 'Draft',    value: countByStatus('DRAFT'),     cls: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className={cn('text-2xl font-bold', s.cls)}>{s.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="px-6 pb-3 flex items-center gap-3 flex-wrap">
        <div className="relative min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
        </div>
        <div className="flex gap-1">
          {['ALL', 'APPROVED', 'PENDING', 'DRAFT', 'REJECTED'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors',
                statusFilter === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300')}>
              {s === 'ALL' ? 'All' : (STATUS_META[s]?.label ?? s)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {['ALL', 'MARKETING', 'UTILITY', 'AUTHENTICATION'].map(c => (
            <button key={c} onClick={() => setCategoryFilter(c)}
              className={cn('px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors',
                categoryFilter === c ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300')}>
              {c === 'ALL' ? 'All Categories' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center pt-20">
            <FileText size={48} className="mx-auto mb-3 text-gray-200" />
            <p className="text-gray-500 font-medium">{templates.length === 0 ? 'No templates yet' : 'No results'}</p>
            {templates.length === 0 && (
              <button onClick={() => setView('create')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
                <Plus className="w-4 h-4" /> Create your first template
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {/* Create new card */}
            <button onClick={() => setView('create')}
              className="bg-white border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2 min-h-[200px] hover:border-teal-400 hover:bg-teal-50/50 transition-colors group">
              <div className="w-10 h-10 bg-gray-100 group-hover:bg-teal-100 rounded-full flex items-center justify-center transition-colors">
                <Plus className="w-5 h-5 text-gray-400 group-hover:text-teal-600" />
              </div>
              <span className="text-sm text-gray-400 group-hover:text-teal-600 font-medium">New Template</span>
            </button>
            {filtered.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onPreview={() => setPreview(t)}
                onEdit={() => { setEditTarget(t); setView('edit'); }}
                onDelete={() => { void handleDelete(t); }}
              />
            ))}
          </div>
        )}
      </div>

      {preview && <PreviewModal template={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
