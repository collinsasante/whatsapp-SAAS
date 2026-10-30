'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { digitalSelfApi } from '@/lib/api';
import { cn, getApiError } from '@/lib/utils';
import { showConfirm } from '@/store/confirm.store';
import { describeStyle, OVERRIDE_FIELDS, STATUS_LABEL, STATUS_TONE, type DigitalSelf, type DigitalSelfList } from '@/lib/digital-self';

const SELECT = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';

/** Admin view of every agent's AI Digital Self: what it has learned, and the controls to pause, deactivate, correct or reset it. */
export function DigitalSelfSection() {
  const [data, setData] = useState<DigitalSelfList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await digitalSelfApi.list()).data as DigitalSelfList);
      setError(false);
    } catch (err) {
      console.error('Could not load Digital Selves', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const replace = (updated: DigitalSelf) => setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === updated.id ? updated : i)) } : d));

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={14} className="text-teal-600" />
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI Digital Selves</p>
      </div>
      <p className="text-xs text-gray-500 mb-3 max-w-2xl">
        Each agent has a Digital Self that learns how they write from the replies they send. It sets the style of Verz AI&apos;s replies when you choose it for a conversation.
        It never changes prices, stock or policies, and it does not turn AI replies on.
      </p>

      {data && !data.featureEnabled && (
        <p className="mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700">
          Learning and styling are not switched on for this workspace yet, so no agent is being learned from and replies are not affected.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-teal-600" size={20} /></div>
      ) : error || !data ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          Could not load Digital Selves. <button className="underline font-medium" onClick={() => { setLoading(true); void load(); }}>Try again</button>
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 bg-white border border-gray-100 rounded-2xl">No agents yet. A Digital Self is created automatically for each agent.</p>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
          {data.items.map((ds) => <Row key={ds.id} ds={ds} thresholds={data.thresholds} onChange={replace} />)}
        </div>
      )}
    </div>
  );
}

function Row({ ds, thresholds, onChange }: { ds: DigitalSelf; thresholds: DigitalSelfList['thresholds']; onChange: (d: DigitalSelf) => void }) {
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const run = async (action: () => Promise<{ data: unknown }>, success: string) => {
    setBusy(true);
    try {
      onChange((await action()).data as DigitalSelf);
      toast.success(success);
    } catch (err) {
      toast.error(getApiError(err, 'That change could not be saved'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!(await showConfirm(`Reset ${ds.name}'s Digital Self?`, { subtext: 'It forgets everything learned and starts again. Style corrections you set are kept.', confirmLabel: 'Reset', danger: true }))) return;
    await run(() => digitalSelfApi.reset(ds.id), 'Learning reset');
  };

  const traits = describeStyle(ds.summary);
  const remaining = Math.max(0, thresholds.minAttributeSamples - ds.summary.samples);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 truncate">{ds.name}</span>
            <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', STATUS_TONE[ds.status])}>{STATUS_LABEL[ds.status]}</span>
            {!ds.assignable && <span className="text-[11px] text-gray-500">Not available to assign</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {ds.evidenceCount === 0 ? 'No replies learned from yet' : `Learned from ${ds.evidenceCount} ${ds.evidenceCount === 1 ? 'reply' : 'replies'}`}
            {ds.lastLearnedAt ? `, last on ${new Date(ds.lastLearnedAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          <Switch label="Learning" checked={!ds.learningPaused} disabled={busy} onChange={(on) => run(() => digitalSelfApi.setLearningPaused(ds.id, !on), on ? 'Learning resumed' : 'Learning paused')} />
          <Switch label="Active" checked={ds.enabled} disabled={busy} onChange={(on) => run(() => digitalSelfApi.setEnabled(ds.id, on), on ? 'Digital Self activated' : 'Digital Self deactivated')} />
        </div>
      </div>

      {traits.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${ds.name}'s communication style`}>
          {traits.map((t) => <li key={t} className="text-[11px] text-gray-700 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">{t}</li>)}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">
          Not enough replies to describe a style yet{remaining > 0 && ds.evidenceCount < thresholds.minAttributeSamples ? ` (${remaining} more needed)` : ''}. Until then Verz AI uses its usual voice.
        </p>
      )}
      {ds.status === 'READY' && <p className="text-[11px] text-gray-400">Ready means at least {thresholds.readySamples} replies have been learned from, not that the style is perfect.</p>}
      {ds.lastError && <p role="alert" className="text-xs text-red-600">Last learning attempt failed: {ds.lastError}</p>}

      <div className="flex items-center gap-3 flex-wrap text-xs">
        <button type="button" onClick={() => setAdjusting((a) => !a)} aria-expanded={adjusting} className="font-medium text-teal-700 hover:underline">
          {adjusting ? 'Hide style corrections' : 'Correct style'}
        </button>
        <Link href="/ai/test-chat" className="font-medium text-teal-700 hover:underline">Preview in Test Chat</Link>
        <button type="button" onClick={() => void reset()} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">Reset learning</button>
      </div>

      {adjusting && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {OVERRIDE_FIELDS.map((f) => {
            const learnedOrSet = ds.summary[f.key === 'length' ? 'replyLength' : f.key];
            return (
              <label key={f.key} className="text-[11px] text-gray-500 space-y-1">
                <span>{f.label}</span>
                <select
                  className={SELECT}
                  disabled={busy}
                  value={ds.summary.overridden.includes(f.key) ? (learnedOrSet ?? '') : ''}
                  onChange={(e) => void run(() => digitalSelfApi.setOverrides(ds.id, { [f.key]: e.target.value || null }), 'Style correction saved')}
                >
                  <option value="">Use what was learned</option>
                  {f.options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative w-9 h-5 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-teal-600' : 'bg-gray-300')}
      >
        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', checked && 'translate-x-4')} />
      </button>
    </label>
  );
}
