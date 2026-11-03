'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { aiLearningApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LearningSettingsView, PrivacyHoldings, apiErrorMessage, microsToUsd } from './learning-privacy.types';

function Switch({ checked, onChange, disabled, labelId }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; labelId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-gray-900' : 'bg-gray-300',
      )}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

function StatusPill({ view }: { view: LearningSettingsView }) {
  const [label, tone] =
    view.blockedReason === 'disclosure_outdated' ? ['Needs your review', 'bg-amber-50 text-amber-700']
    : view.learningActive ? ['Learning is on', 'bg-green-50 text-green-700']
    : view.blockedReason === 'paused' ? ['Paused', 'bg-blue-50 text-blue-700']
    : ['Off', 'bg-gray-100 text-gray-600'];
  return <span className={cn('text-[11px] px-2.5 py-1 rounded-full font-medium', tone)}>{label}</span>;
}

export default function LearningPrivacyPanel() {
  const [view, setView] = useState<LearningSettingsView | null>(null);
  const [holdings, setHoldings] = useState<PrivacyHoldings | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const ids = { learning: useId(), pause: useId(), guidance: useId(), agree: useId() };

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [s, h] = await Promise.all([aiLearningApi.getSettings(), aiLearningApi.privacyHoldings()]);
      setView(s.data as LearningSettingsView);
      setHoldings(h.data as PrivacyHoldings);
    } catch (e) {
      setFailed(true);
      toast.error(apiErrorMessage(e, 'Could not load the learning and privacy settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (data: Parameters<typeof aiLearningApi.updateSettings>[0], done: string) => {
    setSaving(true);
    try {
      const res = await aiLearningApi.updateSettings(data);
      setView(res.data as LearningSettingsView);
      setAgreed(false);
      toast.success(done);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save the change'));
      // A 409 means the notice changed under us: show the current one.
      if ((e as { response?: { status?: number } })?.response?.status === 409) void load();
    } finally {
      setSaving(false);
    }
  };

  if (loading && !view) return <div className="mb-5 bg-gray-50 rounded-xl h-40 animate-pulse" aria-busy="true" aria-label="Loading learning and privacy settings" />;
  if (failed || !view) {
    return (
      <div className="mb-5 border border-gray-200 rounded-xl p-4 text-sm text-gray-600 flex items-center justify-between gap-3">
        <span>The learning and privacy settings could not be loaded.</span>
        <button onClick={() => void load()} className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white font-medium">Try again</button>
      </div>
    );
  }

  const outdated = view.blockedReason === 'disclosure_outdated';
  const needsAck = !view.learningEnabled || view.acknowledgement.needsAcknowledgement;
  const canTurnOn = view.optInAvailable;
  const ackLabel = view.acknowledgement.at ? `Acknowledged ${new Date(view.acknowledgement.at).toLocaleDateString()}` : null;

  return (
    <section aria-labelledby="learning-privacy-heading" className="mb-6 border border-gray-200 rounded-xl p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 id="learning-privacy-heading" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ShieldCheck size={16} aria-hidden /> Learning and privacy
        </h3>
        <StatusPill view={view} />
      </div>

      {outdated && (
        <div role="alert" className="flex items-start gap-2 bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2.5 mb-3">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
          <span>The learning notice has changed since it was last acknowledged. Learning stays stopped until you read the current notice and acknowledge it.</span>
        </div>
      )}

      <p className="text-xs text-gray-600 mb-3">{view.disclosure.summary}</p>

      <details className="mb-4 group" open={outdated || !view.learningEnabled}>
        <summary className="cursor-pointer text-xs font-medium text-gray-900 select-none py-1">{view.disclosure.title}</summary>
        <div className="mt-2 space-y-3">
          {view.disclosure.sections.map((section) => (
            <div key={section.id}>
              <h4 className="text-xs font-semibold text-gray-800 mb-1">{section.heading}</h4>
              <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
                {section.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {needsAck && (
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <label htmlFor={ids.agree} className="flex items-start gap-2 text-xs text-gray-800 cursor-pointer">
            <input id={ids.agree} type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4" disabled={saving || (!view.learningEnabled && !canTurnOn)} />
            <span>I have read and understood this notice and I am authorised to agree to it for this workspace.</span>
          </label>
          {!view.learningEnabled && !canTurnOn && (
            <p className="text-[11px] text-gray-500 mt-2">Learning is not available for workspaces yet. You will be able to turn it on here once it is.</p>
          )}
          <button
            type="button"
            disabled={!agreed || saving || (!view.learningEnabled && !canTurnOn)}
            onClick={() => save(view.learningEnabled ? { acknowledgedDisclosureVersion: view.disclosure.version } : { learningEnabled: true, acknowledgedDisclosureVersion: view.disclosure.version }, view.learningEnabled ? 'Notice acknowledged' : 'Learning is on')}
            className="mt-3 inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={13} className="animate-spin" aria-hidden />}
            {view.learningEnabled ? 'Acknowledge and resume' : 'Turn on learning'}
          </button>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div id={ids.learning} className="text-xs font-medium text-gray-900">Learning</div>
            <div className="text-[11px] text-gray-500">Off by default. Turning it off stops all new evaluation and style learning.</div>
          </div>
          <Switch labelId={ids.learning} checked={view.learningEnabled} disabled={saving || !view.learningEnabled} onChange={() => save({ learningEnabled: false }, 'Learning is off')} />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div id={ids.pause} className="text-xs font-medium text-gray-900">Pause learning</div>
            <div className="text-[11px] text-gray-500">Stops learning for now without turning it off. Digital Self profiles and approved guidance keep working.</div>
          </div>
          <Switch labelId={ids.pause} checked={view.learningPaused} disabled={saving} onChange={(next) => save({ learningPaused: next }, next ? 'Learning paused' : 'Learning resumed')} />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div id={ids.guidance} className="text-xs font-medium text-gray-900">Use approved guidance in replies</div>
            <div className="text-[11px] text-gray-500">Applies training examples you approved. Independent of the switches above.</div>
          </div>
          <Switch labelId={ids.guidance} checked={view.approvedGuidanceEnabled} disabled={saving} onChange={(next) => save({ approvedGuidanceEnabled: next }, next ? 'Approved guidance is on' : 'Approved guidance is off')} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-gray-500">
        {ackLabel && <div className="flex justify-between gap-3"><dt>Notice</dt><dd className="text-gray-700">{ackLabel}{view.acknowledgement.current ? '' : ' (out of date)'}</dd></div>}
        <div className="flex justify-between gap-3"><dt>Evaluation cost this month</dt><dd className="text-gray-700">{microsToUsd(view.usage.workspaceMicros)} of {microsToUsd(view.usage.workspaceCapMicros)}</dd></div>
      </dl>
      <p className="text-[11px] text-gray-500 mt-1">Evaluation is paid by VerzChat and is never taken from your AI credits.</p>

      {holdings && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h4 className="text-xs font-semibold text-gray-800 mb-1.5">What is held for this workspace</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>{holdings.interactionRecordsWithText} interaction record{holdings.interactionRecordsWithText === 1 ? '' : 's'} with message text{holdings.oldestInteractionRecordAt ? `, oldest ${new Date(holdings.oldestInteractionRecordAt).toLocaleDateString()}` : ''}</li>
            <li>{holdings.evaluationsWithText} evaluation{holdings.evaluationsWithText === 1 ? '' : 's'} with written notes, {holdings.reviewTasksWithText} review task{holdings.reviewTasksWithText === 1 ? '' : 's'} with text</li>
            <li>{holdings.trainingExamples.total} training example{holdings.trainingExamples.total === 1 ? '' : 's'} ({holdings.trainingExamples.approved} approved)</li>
          </ul>
          <p className="text-[11px] text-gray-500 mt-2">
            {holdings.automaticDeletion.enabled
              ? `Free text is deleted automatically ${holdings.automaticDeletion.freeTextDays} days after it was created, and scores after ${holdings.automaticDeletion.metricsMonths} months. Approved examples stay until you delete them.`
              : 'Automatic deletion is not switched on yet. These records stay until you delete the conversation, the contact, or the training example.'}
          </p>
        </div>
      )}
    </section>
  );
}
