'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserRole } from '@whatsapp-platform/shared-types';
import { digitalSelfApi } from '@/lib/api';
import { getApiError, cn } from '@/lib/utils';
import { CONSENT_LABEL, CONSENT_TONE, describeStyle, type MyDigitalSelf } from '@/lib/digital-self';
import { useAuthStore } from '@/store/auth.store';
import { showConfirm } from '@/store/confirm.store';

const ELIGIBLE: UserRole[] = [UserRole.ADMIN, UserRole.AGENT];

/**
 * The agent's own control over their Digital Self, on the Account page that every role can already open: see the decision, change it, and ask for
 * what was learned to be deleted. Always about the signed-in person; there is no way to act for someone else from here.
 * Shown when there is something to decide (the workspace has made it available) or something to manage (they decided before, or data exists).
 */
export function DigitalSelfAccountCard() {
  const role = useAuthStore((s) => s.user?.role);
  const [state, setState] = useState<MyDigitalSelf | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      setState((await digitalSelfApi.mine()).data as MyDigitalSelf);
    } catch (err) {
      console.warn('Digital Self status could not be loaded:', getApiError(err));
    }
  }, []);

  useEffect(() => {
    if (role && ELIGIBLE.includes(role)) void load();
  }, [role, load]);

  const run = async (name: string, action: () => Promise<unknown>, success: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(name);
    try {
      await action();
      await load();
      toast.success(success);
    } catch (err) {
      toast.error(getApiError(err, 'That could not be saved. Please try again.'));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (!state?.eligible || !state.consent) return null;
  const status = state.consent.status;
  const evidence = state.learned?.evidenceCount ?? 0;
  if (!state.workspaceAvailable && status === 'PENDING' && evidence === 0) return null; // nothing to decide and nothing to manage

  const agree = () => run('agree', () => digitalSelfApi.decideConsent('ACCEPT', { version: state.consentVersion }), 'Thanks. Verz AI can now learn your style.');
  const withdraw = async () => {
    const ok = await showConfirm('Withdraw your consent?', { subtext: 'Learning and use of your style stop straight away. What was already learned is kept until you delete it.', confirmLabel: 'Withdraw' });
    if (ok) await run('withdraw', () => digitalSelfApi.decideConsent('WITHDRAW'), 'Consent withdrawn. Nothing more will be learned.');
  };
  const erase = async () => {
    const ok = await showConfirm('Delete everything learned about you?', { subtext: 'This removes the style Verz AI built from your replies. It cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (ok) await run('erase', () => digitalSelfApi.eraseMine(), 'What was learned about you has been deleted.');
  };

  const traits = state.learned?.summary ? describeStyle(state.learned.summary) : [];
  const sentence =
    status === 'GRANTED' ? `Verz AI learns from your replies and can write in your style${state.consent.decidedAt ? `. You agreed on ${new Date(state.consent.decidedAt).toLocaleDateString()}` : ''}.`
    : status === 'DECLINED' ? 'You declined. Nothing is learned from you.'
    : status === 'WITHDRAWN' ? 'You withdrew your consent. Learning and use of your style have stopped.'
    : 'You have not decided yet. Nothing is learned until you agree.';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" data-testid="digital-self-card">
      <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
        <PenLine size={16} className="text-teal-600" />
        <span className="font-semibold text-gray-800">Writing style</span>
        <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium', CONSENT_TONE[status])}>{CONSENT_LABEL[status]}</span>
      </div>
      <div className="px-6 py-6 space-y-4">
        <p className="text-sm text-gray-700">{sentence}</p>

        {evidence > 0 && (
          <p className="text-xs text-gray-500">
            {evidence} {evidence === 1 ? 'reply' : 'replies'} learned from{state.learned?.lastLearnedAt ? `, last on ${new Date(state.learned.lastLearnedAt).toLocaleDateString()}` : ''}.
          </p>
        )}
        {traits.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Your communication style">
            {traits.map((t) => <li key={t} className="rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-700">{t}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {status === 'GRANTED' ? (
            <button type="button" disabled={busy !== null} onClick={() => void withdraw()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-60">
              {busy === 'withdraw' && <Loader2 className="h-4 w-4 animate-spin" />}Withdraw consent
            </button>
          ) : (
            <button type="button" disabled={busy !== null || !state.workspaceAvailable} onClick={() => void agree()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60">
              {busy === 'agree' && <Loader2 className="h-4 w-4 animate-spin" />}Agree
            </button>
          )}
          {evidence > 0 && (
            <button type="button" disabled={busy !== null} onClick={() => void erase()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-100 transition-colors hover:bg-red-50 disabled:opacity-60">
              {busy === 'erase' && <Loader2 className="h-4 w-4 animate-spin" />}Delete what was learned
            </button>
          )}
        </div>
        {!state.workspaceAvailable && status !== 'GRANTED' && <p className="text-xs text-gray-400">Digital Self is not switched on for this workspace right now.</p>}
        <p className="text-xs text-gray-400">Only you can change this. Admins can see whether you agreed, not what you wrote.</p>
      </div>
    </div>
  );
}
