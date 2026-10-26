'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { internalTasksApi } from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { showConfirm } from '@/store/confirm.store';
import { Button } from '@/components/ui/Button';
import SidePanel from '@/components/ui/SidePanel';
import StatusBadge from '@/components/ui/StatusBadge';
import { SelectInput } from '@/components/ui/fields';
import { formatWaiting } from '@/lib/analytics/format';
import { formatDateTime } from '@/lib/commerce/format';
import { isActive, PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskStatus, type TeamMember } from '@/lib/tasks/model';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/** One task: its details, the places it points to, and the changes the server allows. */
export default function TaskPanel({ task, members, myId, onClose, onChanged }: {
  task: Task | null;
  members: TeamMember[];
  myId: string | undefined;
  onClose: () => void;
  /** Called after a change so the list behind the panel is reloaded. */
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState('');
  const nameOf = useCallback((id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? 'A former team member' : null), [members]);

  const change = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); await onChanged(); onClose(); }
    catch (e) { toast.error(getApiError(e, 'That did not work. The task was not changed.')); }
    finally { setBusy(false); }
  };
  const setStatus = (status: TaskStatus, done: string) => change(async () => { await internalTasksApi.updateStatus(task!.id, status); toast.success(done); });
  const assignTo = (userId: string, done: string) => change(async () => { await internalTasksApi.assign(task!.id, userId); toast.success(done); });

  const status = task ? STATUS_LABEL[task.status] : null;
  const priority = task ? PRIORITY_LABEL[task.priority] : null;
  const active = task ? isActive(task) : false;

  const footer = task ? (
    <>
      {busy && <Loader2 size={14} className="animate-spin text-gray-500" aria-label="Working" />}
      {task.status === 'OPEN' && <Button variant="secondary" onClick={() => setStatus('IN_PROGRESS', 'The task is in progress.')} disabled={busy}>Start working</Button>}
      {active && <Button onClick={() => setStatus('DONE', 'The task is done.')} disabled={busy}>Mark done</Button>}
      {active && <Button variant="danger" disabled={busy} onClick={async () => { if (await showConfirm('Cancel this task?', { subtext: 'Nothing more needs doing. You can reopen it later.', confirmLabel: 'Cancel task' })) await setStatus('CANCELLED', 'The task was cancelled.'); }}>Cancel task</Button>}
      {!active && <Button variant="secondary" onClick={() => setStatus('OPEN', 'The task is open again.')} disabled={busy}>Reopen</Button>}
    </>
  ) : undefined;

  return (
    <SidePanel
      open={task != null} onClose={onClose} footer={footer}
      title={task?.title ?? 'Task'}
      description={task ? <span className="inline-flex flex-wrap items-center gap-1.5">{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}{priority && <StatusBadge tone={priority.tone}>{priority.label} priority</StatusBadge>}</span> : undefined}
    >
      {task && (
        <div className="space-y-6">
          <section aria-labelledby="task-what">
            <h3 id="task-what" className="text-sm font-semibold text-gray-900">What needs doing</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{task.description || 'No details were added to this task.'}</p>
          </section>

          <section aria-labelledby="task-who">
            <h3 id="task-who" className="text-sm font-semibold text-gray-900">Who has it</h3>
            <dl className="mt-1 divide-y divide-gray-100">
              <Row label="Team">{task.department}</Row>
              <Row label="Assigned to">{nameOf(task.assigneeId) ?? <span className="text-gray-500">Nobody yet</span>}</Row>
            </dl>
            {active && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {myId && task.assigneeId !== myId && <Button variant="secondary" size="sm" onClick={() => assignTo(myId, 'The task is yours.')} disabled={busy}>Take it myself</Button>}
                <SelectInput
                  label="Assign to a team member" value={assignee} onChange={setAssignee} className="w-48"
                  options={[{ value: '', label: 'Assign to...' }, ...members.filter((m) => m.isActive !== false).map((m) => ({ value: m.id, label: m.name }))]}
                />
                <Button variant="secondary" size="sm" disabled={busy || !assignee} onClick={() => assignTo(assignee, `Assigned to ${nameOf(assignee) ?? 'them'}.`)}>Assign</Button>
              </div>
            )}
          </section>

          <section aria-labelledby="task-when">
            <h3 id="task-when" className="text-sm font-semibold text-gray-900">When</h3>
            <dl className="mt-1 divide-y divide-gray-100">
              <Row label="Created">{formatDateTime(task.createdAt)}{task.createdById ? `, by ${nameOf(task.createdById)}` : ', automatically'}</Row>
              {active
                ? <Row label="Waiting">{formatWaiting((Date.now() - Date.parse(task.createdAt)) / 1000)}</Row>
                : task.resolvedAt && <Row label={task.status === 'DONE' ? 'Completed' : 'Cancelled'}>{formatDateTime(task.resolvedAt)}{task.resolvedById ? `, by ${nameOf(task.resolvedById)}` : ''}</Row>}
            </dl>
          </section>

          {(task.conversationId || task.orderId) && (
            <section aria-labelledby="task-links">
              <h3 id="task-links" className="text-sm font-semibold text-gray-900">Related</h3>
              <ul className="mt-1 space-y-1.5 text-sm">
                {task.conversationId && <li><Link href={`/inbox?c=${task.conversationId}`} className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">Open the conversation<ExternalLink size={12} aria-hidden="true" /></Link></li>}
                {task.orderId && <li><Link href={`/commerce/orders?order=${task.orderId}`} className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">Open the order<ExternalLink size={12} aria-hidden="true" /></Link></li>}
              </ul>
            </section>
          )}
        </div>
      )}
    </SidePanel>
  );
}
