'use client';
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { internalTasksApi, usersApi } from '@/lib/api';
import { useWidget } from '@/lib/dashboard/useWidget';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { formatWaiting } from '@/lib/analytics/format';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import StatStrip from '@/components/ui/StatStrip';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import Tabs from '@/components/ui/Tabs';
import { SearchInput, SelectInput } from '@/components/ui/fields';
import TaskPanel from '@/components/tasks/TaskPanel';
import {
  byUrgency, inView, isActive, PRIORITY_LABEL, STATUS_LABEL, upNext,
  type Task, type TaskPriority, type TaskView, type TeamMember,
} from '@/lib/tasks/model';

const PAGE_SIZE = 20;
const FETCH_LIMIT = 500;
const waited = (t: Task) => formatWaiting((Date.now() - Date.parse(t.createdAt)) / 1000);

export default function TasksPage() {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id;
  const [view, setView] = useState<TaskView>('active');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState<'ALL' | TaskPriority>('ALL');
  const [assignee, setAssignee] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const tasks = useWidget<Task[]>('tasks', async (signal) => (await internalTasksApi.list({ limit: FETCH_LIMIT }, signal)).data as Task[]);
  const members = useWidget<TeamMember[]>('task-members', async (signal) => {
    const res = await usersApi.list(signal);
    return (res.data as Array<TeamMember>).map((u) => ({ id: u.id, name: u.name, isActive: u.isActive }));
  });
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? 'Former team member' : null);

  const teams = useMemo(() => [...new Set(all.map((t) => t.department))].sort((a, b) => a.localeCompare(b)), [all]);
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) =>
      (priority === 'ALL' || t.priority === priority)
      && (assignee === 'ALL' || (assignee === 'NONE' ? t.assigneeId == null : t.assigneeId === assignee))
      && (team === 'ALL' || t.department === team)
      && (!q || t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)));
  }, [all, query, priority, assignee, team]);

  const shown = useMemo(() => {
    const rows = matching.filter((t) => inView(t, view, myId));
    // Work to do is ordered by urgency; finished work, newest first.
    return view === 'done' || view === 'all' ? rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : rows.sort(byUrgency);
  }, [matching, view, myId]);

  const count = (v: TaskView) => matching.filter((t) => inView(t, v, myId)).length;
  const activeAll = all.filter(isActive);
  const urgent = activeAll.filter((t) => t.priority === 'URGENT' || t.priority === 'HIGH').length;
  const unassigned = activeAll.filter((t) => t.assigneeId == null).length;
  const oldest = activeAll.length ? Math.min(...activeAll.map((t) => Date.parse(t.createdAt))) : null;
  const next = useMemo(() => upNext(all, myId), [all, myId]);
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const open = all.find((t) => t.id === openId) ?? null;
  const filtering = query.trim() !== '' || priority !== 'ALL' || assignee !== 'ALL' || team !== 'ALL';
  const clear = () => { setQuery(''); setPriority('ALL'); setAssignee('ALL'); setTeam('ALL'); setPage(1); };
  const reload = () => { tasks.reload(); members.reload(); };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <PageHeader
          title="Tasks"
          description="Work handed to your team. The AI assistant and the payment and approval steps create tasks for you; you pick them up here."
          actions={<Button variant="secondary" onClick={reload} disabled={tasks.loading} aria-label="Refresh tasks"><RefreshCw size={14} aria-hidden="true" className={cn(tasks.loading && 'animate-spin')} />Refresh</Button>}
        />

        {tasks.data && (
          <>
            <StatStrip label="Task summary" stats={[
              { label: 'To do', value: activeAll.length.toLocaleString(), hint: `${unassigned.toLocaleString()} not taken by anyone`, onSelect: () => { setView('active'); setPage(1); }, selected: view === 'active' },
              { label: 'Urgent or high', value: urgent.toLocaleString(), tone: urgent > 0 ? 'bad' : 'default', hint: 'Still to do' },
              { label: 'In progress', value: all.filter((t) => t.status === 'IN_PROGRESS').length.toLocaleString(), onSelect: () => { setView('progress'); setPage(1); }, selected: view === 'progress' },
              { label: 'Waiting longest', value: oldest ? formatWaiting((Date.now() - oldest) / 1000) : 'None', hint: oldest ? 'Oldest task still to do' : 'Nothing is waiting' },
            ]} />

            {next && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3" role="region" aria-label="Up next">
                <p className="min-w-0 text-sm text-gray-800">
                  <span className="font-semibold">Up next: </span>{next.title}
                  <span className="text-gray-600">{' '}({PRIORITY_LABEL[next.priority].label.toLowerCase()} priority, waiting {waited(next)})</span>
                </p>
                <Button size="sm" onClick={() => setOpenId(next.id)}>Open task</Button>
              </div>
            )}
          </>
        )}

        <section aria-label="Task list" className="rounded-xl border border-gray-200 bg-white">
          <div className="px-3 pt-1">
            <Tabs idPrefix="task-tab" label="Task views" active={view} onChange={(k) => { setView(k as TaskView); setPage(1); }}
              tabs={[
                { key: 'active', label: 'To do', count: count('active') }, { key: 'mine', label: 'Mine', count: count('mine') },
                { key: 'open', label: 'Not started', count: count('open') }, { key: 'progress', label: 'In progress', count: count('progress') },
                { key: 'done', label: 'Done', count: count('done') }, { key: 'all', label: 'Everything', count: count('all') },
              ]} />
          </div>
          <div className="flex flex-col gap-2 border-b border-gray-200 p-3 lg:flex-row lg:items-center">
            <SearchInput label="Search tasks" placeholder="Search tasks" value={query} onChange={(v) => { setQuery(v); setPage(1); }} className="lg:flex-1" />
            <SelectInput label="Priority" value={priority} onChange={(v) => { setPriority(v as 'ALL' | TaskPriority); setPage(1); }} className="lg:w-40"
              options={[{ value: 'ALL', label: 'Any priority' }, ...(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as TaskPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p].label }))]} />
            <SelectInput label="Assigned to" value={assignee} onChange={(v) => { setAssignee(v); setPage(1); }} className="lg:w-48"
              options={[{ value: 'ALL', label: 'Anyone' }, { value: 'NONE', label: 'Nobody yet' }, ...people.map((p) => ({ value: p.id, label: p.id === myId ? `${p.name} (you)` : p.name }))]} />
            {teams.length > 1 && <SelectInput label="Team" value={team} onChange={(v) => { setTeam(v); setPage(1); }} className="lg:w-44" options={[{ value: 'ALL', label: 'Any team' }, ...teams.map((t) => ({ value: t, label: t }))]} />}
          </div>

          <div role="tabpanel" aria-labelledby={`task-tab-${view}`}>
            {tasks.loading && !tasks.data ? (
              <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading tasks">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : tasks.error && !tasks.data ? (
              <div role="alert" className="m-4 flex flex-col items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-4">
                <p className="text-sm font-medium text-gray-900">Tasks could not be loaded</p>
                <p className="text-sm text-gray-600">{tasks.error}</p>
                <Button size="sm" onClick={tasks.reload}>Try again</Button>
              </div>
            ) : all.length === 0 ? (
              <div className="p-4"><EmptyState compact={false} title="No tasks yet">When a customer pays, or the AI assistant needs a person to step in, a task appears here for your team.</EmptyState></div>
            ) : shown.length === 0 ? (
              <div className="p-4">
                <EmptyState compact={false} title={view === 'mine' ? 'Nothing is assigned to you' : filtering ? 'No tasks match' : 'Nothing here'}>
                  {view === 'mine' ? 'Open the To do tab and take a task to see it here.' : filtering ? 'Try a different search or clear the filters.' : view === 'done' ? 'Finished tasks will be listed here.' : 'You are all caught up.'}
                </EmptyState>
                {filtering && <div className="mt-3 text-center"><Button variant="secondary" onClick={clear}>Clear filters</Button></div>}
              </div>
            ) : (
              <>
                {tasks.error && <p role="alert" className="px-4 pt-3 text-sm text-red-700">Could not refresh the list. {tasks.error} <button onClick={tasks.reload} className="font-medium underline">Try again</button></p>}
                <div className={cn('overflow-x-auto', tasks.loading && 'opacity-60')}>
                  <table className="w-full text-sm">
                    <caption className="sr-only">Tasks, {shown.length} shown</caption>
                    <thead className="bg-gray-50 text-left text-xs text-gray-500">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Task</th>
                        <th scope="col" className="px-4 py-2 font-medium">Priority</th>
                        <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Status</th>
                        <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Assigned to</th>
                        <th scope="col" className="hidden px-4 py-2 text-right font-medium lg:table-cell">Waiting</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <button type="button" onClick={() => setOpenId(t.id)} className="block w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
                              <span className="block max-w-md truncate font-medium text-gray-900">{t.title}</span>
                              <span className="block max-w-md truncate text-xs text-gray-500">{t.department}{t.description ? `, ${t.description}` : ''}</span>
                            </button>
                          </td>
                          <td className="px-4 py-2.5"><StatusBadge tone={PRIORITY_LABEL[t.priority].tone}>{PRIORITY_LABEL[t.priority].label}</StatusBadge></td>
                          <td className="hidden px-4 py-2.5 sm:table-cell"><StatusBadge tone={STATUS_LABEL[t.status].tone}>{STATUS_LABEL[t.status].label}</StatusBadge></td>
                          <td className="hidden px-4 py-2.5 text-gray-700 md:table-cell">{nameOf(t.assigneeId) ?? <span className="text-gray-400">Nobody yet</span>}</td>
                          <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-600 lg:table-cell">{isActive(t) ? waited(t) : <span className="text-gray-400">Closed</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} noun="tasks" />
                {all.length >= FETCH_LIMIT && <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">Showing the {FETCH_LIMIT} newest tasks.</p>}
              </>
            )}
          </div>
        </section>
      </div>

      <TaskPanel task={open} members={people} myId={myId} onClose={() => setOpenId(null)} onChanged={tasks.reload} />
    </div>
  );
}
