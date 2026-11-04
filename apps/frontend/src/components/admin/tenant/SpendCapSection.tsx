'use client';
import { useState } from 'react';
import { adminApi, type AiSpendSummary } from '@/lib/admin-api';
import { useAdminData } from '@/lib/admin/hooks';
import { formatDateTime, formatNumber } from '@/lib/admin/format';
import { Section } from '../PageHeader';
import { StatusPill } from '../StatusPill';
import { SuperAdminOnly } from '../RoleGate';

const LABEL = { OK: 'Within cap', WARNING: 'Near the cap', REACHED: 'Cap reached, AI paused', NO_CAP: 'No cap' } as const;
const TONE = { OK: 'success', WARNING: 'warning', REACHED: 'danger', NO_CAP: 'neutral' } as const;

/** A workspace's daily AI credit cap: where it stands, when it resets, and (super admins) how to change it. */
export function SpendCapSection({ tenantId }: { tenantId: string }) {
  const spend = useAdminData(() => adminApi.workspaceAiSpend(tenantId), [tenantId]);
  const s: AiSpendSummary | null = spend.data ?? null;
  const [cap, setCap] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const capText = cap ?? (s?.dailyCreditCap ?? '').toString();
  const warnText = warn ?? (s?.capWarnPercent ?? 80).toString();

  const save = async (remove: boolean) => {
    setMessage(null);
    const capValue = remove || capText.trim() === '' ? null : Number(capText);
    const warnValue = Number(warnText);
    if (capValue !== null && (!Number.isInteger(capValue) || capValue < 0)) return setMessage({ ok: false, text: 'The cap must be a whole number of credits, 0 or more.' });
    if (!Number.isInteger(warnValue) || warnValue < 1 || warnValue > 99) return setMessage({ ok: false, text: 'The warning level must be a whole percentage from 1 to 99.' });
    setSaving(true);
    try {
      await adminApi.setAiDailyCreditCap(tenantId, { cap: capValue, warnPercent: warnValue });
      setCap(null); setWarn(null);
      setMessage({ ok: true, text: capValue === null ? 'Cap removed.' : 'Cap saved.' });
      spend.reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not save the cap.' });
    } finally { setSaving(false); }
  };

  return (
    <Section title="Daily spend cap" description="Limits how many credits Verz AI may use per day in this workspace's own timezone. At the cap AI replies pause until it resets; conversations stay open for people.">
      {s && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusPill tone={TONE[s.capState]}>{LABEL[s.capState]}</StatusPill>
          {s.dailyCreditCap !== null ? (
            <>
              <p className="text-sm text-gray-800"><span className="font-semibold tabular-nums">{formatNumber(s.spentToday + s.heldNow)}</span> of {formatNumber(s.dailyCreditCap)} credits used today{s.heldNow > 0 ? ` (${formatNumber(s.heldNow)} reserved by replies in progress)` : ''}</p>
              <p className="text-sm text-gray-600">Resets {formatDateTime(s.capResetsAt)} ({s.capTimezone})</p>
            </>
          ) : <p className="text-sm text-gray-600">No cap: AI is limited only by the credit balance.</p>}
        </div>
      )}
      <SuperAdminOnly>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-700">Daily cap (credits)
            <input inputMode="numeric" className="mt-1 block w-36 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" value={capText} onChange={(e) => setCap(e.target.value)} placeholder="No cap" />
          </label>
          <label className="text-sm text-gray-700">Warn admins at (%)
            <input inputMode="numeric" className="mt-1 block w-24 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" value={warnText} onChange={(e) => setWarn(e.target.value)} />
          </label>
          <button type="button" disabled={saving} onClick={() => void save(false)} className="rounded-md bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save cap'}</button>
          {s?.dailyCreditCap !== null && s?.dailyCreditCap !== undefined && (
            <button type="button" disabled={saving} onClick={() => void save(true)} className="rounded-md border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Remove cap</button>
          )}
        </div>
      </SuperAdminOnly>
      {message && <p role="status" className={`mt-3 text-sm ${message.ok ? 'text-green-800' : 'text-red-700'}`}>{message.text}</p>}
      {spend.error && <p role="alert" className="mt-3 text-sm text-red-700">Could not load the spend cap. <button type="button" className="underline" onClick={spend.reload}>Try again</button></p>}
    </Section>
  );
}
