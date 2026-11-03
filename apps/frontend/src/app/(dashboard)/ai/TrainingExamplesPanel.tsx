'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { aiLearningApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ExampleStatus, TrainingExample, apiErrorMessage } from './learning-privacy.types';

const STATUS_LABEL: Record<ExampleStatus, string> = { DRAFT: 'Draft', REVIEW: 'In review', APPROVED: 'Approved', REJECTED: 'Rejected', ARCHIVED: 'Archived' };
const INFLUENCE: Record<TrainingExample['influence'], { label: string; tone: string }> = {
  guidance: { label: 'Used in replies', tone: 'bg-green-50 text-green-700' },
  style_correction: { label: 'Shapes one agent’s style', tone: 'bg-blue-50 text-blue-700' },
  none: { label: 'Not used in replies', tone: 'bg-gray-100 text-gray-600' },
};

export default function TrainingExamplesPanel() {
  const [examples, setExamples] = useState<TrainingExample[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setExamples((await aiLearningApi.listTrainingExamples()).data as TrainingExample[]);
    } catch (e) {
      setFailed(true);
      toast.error(apiErrorMessage(e, 'Could not load training examples'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'That did not work. Nothing was changed.'));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  };

  const remove = (example: TrainingExample) =>
    run(example.id, async () => {
      const res = await aiLearningApi.deleteTrainingExample(example.id);
      if ((res.data as { promotedToRegressionCase?: boolean }).promotedToRegressionCase) {
        toast('This example had been copied into VerzChat’s engineering test suite. Ask us to remove that copy.', { icon: '⚠️', duration: 8000 });
      }
    }, 'Training example deleted');

  return (
    <section aria-labelledby="training-examples-heading" className="mt-8">
      <h3 id="training-examples-heading" className="text-sm font-semibold text-gray-900 mb-1">Training examples</h3>
      <p className="text-xs text-gray-500 mb-3">
        Only <strong>approved</strong> examples change how the AI replies. Withdrawing or archiving stops that straight away but keeps the text. Deleting removes the text for good.
      </p>

      {failed ? (
        <div className="border border-gray-200 rounded-xl p-4 text-sm text-gray-600 flex items-center justify-between gap-3">
          <span>Training examples could not be loaded.</span>
          <button onClick={() => void load()} className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white font-medium">Try again</button>
        </div>
      ) : examples === null ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="bg-gray-50 rounded-xl h-16 animate-pulse" />)}</div>
      ) : examples.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">No training examples yet. They appear here when a reviewed conversation is turned into one.</div>
      ) : (
        <ul className="space-y-2">
          {examples.map((example) => {
            const influence = INFLUENCE[example.influence];
            const busy = busyId === example.id;
            return (
              <li key={example.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{STATUS_LABEL[example.status]}</span>
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', influence.tone)}>{influence.label}</span>
                  <span className="text-[11px] text-gray-400 ml-auto">{new Date(example.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-gray-800 line-clamp-2 break-words">{example.customerInput || 'No customer message'}</p>
                {example.expectedResponse && <p className="text-xs text-gray-500 line-clamp-2 break-words mt-1">Expected reply: {example.expectedResponse}</p>}

                {confirmingId === example.id ? (
                  <div role="alertdialog" aria-label="Confirm deletion" className="mt-3 bg-red-50 rounded-lg p-3">
                    <p className="text-xs text-red-800">Delete this example permanently? Its text is removed and this cannot be undone.{example.influence !== 'none' ? ' It will stop being used in replies.' : ''}</p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => void remove(example)} disabled={busy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium disabled:opacity-50">
                        {busy && <Loader2 size={12} className="animate-spin" aria-hidden />} Delete permanently
                      </button>
                      <button onClick={() => setConfirmingId(null)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-white text-gray-700 border border-gray-200 font-medium">Keep it</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {example.status === 'APPROVED' && (
                      <button onClick={() => void run(example.id, () => aiLearningApi.withdrawTrainingExample(example.id), 'Approval withdrawn')} disabled={busy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50">
                        <Undo2 size={12} aria-hidden /> Withdraw approval
                      </button>
                    )}
                    {example.status !== 'ARCHIVED' && (
                      <button onClick={() => void run(example.id, () => aiLearningApi.setTrainingExampleStatus(example.id, 'ARCHIVED'), 'Archived')} disabled={busy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50">
                        <Archive size={12} aria-hidden /> Archive
                      </button>
                    )}
                    {example.status === 'ARCHIVED' && (
                      <button onClick={() => void run(example.id, () => aiLearningApi.setTrainingExampleStatus(example.id, 'REVIEW'), 'Moved back to review')} disabled={busy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50">
                        <RotateCcw size={12} aria-hidden /> Restore to review
                      </button>
                    )}
                    <button onClick={() => setConfirmingId(example.id)} disabled={busy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-red-700 bg-red-50 font-medium disabled:opacity-50 ml-auto">
                      <Trash2 size={12} aria-hidden /> Delete…
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
