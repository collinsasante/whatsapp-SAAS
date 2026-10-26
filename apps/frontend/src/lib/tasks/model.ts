import type { StatusTone } from '@/components/ui/StatusBadge';

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Task {
  id: string;
  department: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  conversationId: string | null;
  orderId: string | null;
  contactId: string | null;
  createdAt: string;
}

export interface TeamMember { id: string; name: string; isActive?: boolean }

export const STATUS_LABEL: Record<TaskStatus, { label: string; tone: StatusTone }> = {
  OPEN: { label: 'Open', tone: 'warning' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  DONE: { label: 'Done', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const PRIORITY_LABEL: Record<TaskPriority, { label: string; tone: StatusTone; rank: number }> = {
  URGENT: { label: 'Urgent', tone: 'danger', rank: 3 },
  HIGH: { label: 'High', tone: 'warning', rank: 2 },
  NORMAL: { label: 'Normal', tone: 'neutral', rank: 1 },
  LOW: { label: 'Low', tone: 'neutral', rank: 0 },
};

export const isActive = (t: Pick<Task, 'status'>) => t.status === 'OPEN' || t.status === 'IN_PROGRESS';

/** Most important first, then the one that has waited longest. This is the order "what next" follows. */
export function byUrgency(a: Task, b: Task): number {
  return PRIORITY_LABEL[b.priority].rank - PRIORITY_LABEL[a.priority].rank || a.createdAt.localeCompare(b.createdAt);
}

/**
 * The task to pick up next: the most urgent active task that is already mine, otherwise one nobody has taken.
 * Tasks held by someone else are never suggested.
 */
export function upNext(tasks: Task[], myId: string | undefined): Task | null {
  const mine = tasks.filter((t) => isActive(t) && myId != null && t.assigneeId === myId).sort(byUrgency);
  if (mine.length) return mine.find((t) => t.status === 'IN_PROGRESS') ?? mine[0];
  return tasks.filter((t) => isActive(t) && t.assigneeId == null).sort(byUrgency)[0] ?? null;
}

export type TaskView = 'active' | 'mine' | 'open' | 'progress' | 'done' | 'all';

export function inView(t: Task, view: TaskView, myId: string | undefined): boolean {
  switch (view) {
    case 'active': return isActive(t);
    case 'mine': return myId != null && t.assigneeId === myId && isActive(t);
    case 'open': return t.status === 'OPEN';
    case 'progress': return t.status === 'IN_PROGRESS';
    case 'done': return t.status === 'DONE';
    default: return true;
  }
}
