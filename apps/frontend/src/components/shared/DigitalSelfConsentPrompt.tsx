'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserRole } from '@whatsapp-platform/shared-types';
import { digitalSelfApi } from '@/lib/api';
import { getApiError } from '@/lib/utils';
import type { MyDigitalSelf } from '@/lib/digital-self';
import { useAuthStore } from '@/store/auth.store';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';

/** Roles that reply to customers and so have a Digital Self. Viewers do not, and are never asked. */
const ELIGIBLE: UserRole[] = [UserRole.ADMIN, UserRole.AGENT];

/**
 * Asks the signed-in agent, once, whether Verz AI may learn their writing style. The server decides when it is due (`promptRequired`): only when the
 * workspace has made Digital Self available and this person has not decided yet (or the wording changed), so it does not return at every login after a
 * decision. It is the agent's own decision: an administrator cannot accept on their behalf, and the choice is stored against them alone.
 * Escape and clicking outside do nothing: closing the prompt is not a decision.
 */
export function DigitalSelfConsentPrompt() {
  const role = useAuthStore((s) => s.user?.role);
  const [state, setState] = useState<MyDigitalSelf | null>(null);
  const [busy, setBusy] = useState<'ACCEPT' | 'DECLINE' | null>(null);
  const [error, setError] = useState('');
  // One decision at a time, even if both buttons are pressed in quick succession.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!role || !ELIGIBLE.includes(role)) return;
    let cancelled = false;
    digitalSelfApi.mine()
      .then((res) => { if (!cancelled) setState(res.data as MyDigitalSelf); })
      .catch((err: unknown) => { console.warn('Digital Self consent status could not be loaded:', getApiError(err)); });
    return () => { cancelled = true; };
  }, [role]);

  const open = !!state?.promptRequired;
  const decide = async (decision: 'ACCEPT' | 'DECLINE') => {
    if (inFlight.current || !state) return;
    inFlight.current = true;
    setBusy(decision);
    setError('');
    try {
      const res = await digitalSelfApi.decideConsent(decision, decision === 'ACCEPT' ? { version: state.consentVersion } : {});
      setState(res.data as MyDigitalSelf);
      toast.success(decision === 'ACCEPT' ? 'Thanks. Verz AI can now learn your style.' : 'Okay. Nothing will be learned from you.');
    } catch (err) {
      setError(getApiError(err, 'That could not be saved. Please try again.'));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (!open) return null;
  return <PromptDialog busy={busy} error={error} reconfirm={state?.consent?.need === 'reconfirm'} onDecide={(d) => void decide(d)} />;
}

function PromptDialog({ busy, error, reconfirm, onDecide }: { busy: 'ACCEPT' | 'DECLINE' | null; error: string; reconfirm: boolean; onDecide: (d: 'ACCEPT' | 'DECLINE') => void }) {
  const ref = useDialogBehavior<HTMLDivElement>(() => undefined);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-gray-900/40 p-0 sm:items-center sm:p-4">
      <div ref={ref} role="dialog" aria-modal="true" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-7">
        <h2 className="text-lg font-semibold text-gray-900">{reconfirm ? 'Our Digital Self wording changed' : 'Let Verz AI learn how you write?'}</h2>
        <p className="mt-1.5 text-sm text-gray-500">
          {reconfirm ? 'Please read it again. Your earlier answer no longer applies until you confirm.' : 'Your choice. You can change it at any time.'}
        </p>

        <dl className="mt-5 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-gray-900">What it learns</dt>
            <dd className="mt-0.5 text-gray-600">Patterns in the replies you send: length, tone, emoji and how you open and close. It keeps counts and style traits, never the message text, customer names or phone numbers.</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-900">How it is used</dt>
            <dd className="mt-0.5 text-gray-600">Verz AI can write in your style on conversations you handle or that are assigned to you. Admins can see whether you agreed, not what you wrote.</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-900">Withdrawing</dt>
            <dd className="mt-0.5 text-gray-600">Withdraw in Account whenever you like. Learning and use of your style stop straight away, and you can ask for everything learned to be deleted.</dd>
          </div>
        </dl>

        <p role="alert" className="mt-4 min-h-5 text-sm text-red-600">{error}</p>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onDecide('DECLINE')}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            {busy === 'DECLINE' && <Loader2 className="h-4 w-4 animate-spin" />}Decline
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onDecide('ACCEPT')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {busy === 'ACCEPT' && <Loader2 className="h-4 w-4 animate-spin" />}Accept
          </button>
        </div>
      </div>
    </div>
  );
}
