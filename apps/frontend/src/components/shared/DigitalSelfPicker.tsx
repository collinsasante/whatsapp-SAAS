'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, EyeOff, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { digitalSelfApi } from '@/lib/api';
import { getApiError, cn } from '@/lib/utils';
import { showConfirm } from '@/store/confirm.store';
import { STATUS_LABEL, type ConversationDigitalSelf, type DigitalSelfList } from '@/lib/digital-self';

interface Props {
  conversationId: string;
  /** Admins, or the agent who owns the conversation. Others can see the choice but not change it. */
  canEdit: boolean;
}

/**
 * Chooses which agent's Digital Self sets the writing style of AI replies in one conversation. It only changes style: the
 * conversation owner stays the same and AI replies are neither turned on nor off by this.
 */
export function DigitalSelfPicker({ conversationId, canEdit }: Props) {
  const [list, setList] = useState<DigitalSelfList | null>(null);
  const [current, setCurrent] = useState<ConversationDigitalSelf | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([digitalSelfApi.list(), digitalSelfApi.forConversation(conversationId)]);
      setList(l.data as DigitalSelfList);
      setCurrent(c.data as ConversationDigitalSelf);
      setFailed(false);
    } catch (err) {
      console.error('Could not load Digital Self choices', err);
      setFailed(true);
    }
  }, [conversationId]);

  useEffect(() => { setList(null); setCurrent(null); void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = async (digitalSelfId: string | null) => {
    setSaving(true);
    try {
      const res = await digitalSelfApi.assign(conversationId, digitalSelfId);
      setCurrent(res.data as ConversationDigitalSelf);
      setOpen(false);
      toast.success(digitalSelfId ? 'AI reply style updated' : 'AI reply style removed');
    } catch (err) {
      toast.error(getApiError(err, 'Could not change the AI reply style'));
    } finally {
      setSaving(false);
    }
  };

  const setExclusion = async (excluded: boolean) => {
    if (excluded && !(await showConfirm('Exclude this conversation from Digital Self learning?', {
      subtext: 'Anything already learned from it is removed from the agents\' profiles. Lifting the exclusion later only affects new replies.',
      confirmLabel: 'Exclude',
      danger: true,
    }))) return;
    setSaving(true);
    try {
      const res = await digitalSelfApi.setLearningExclusion(conversationId, excluded);
      const done = res.data as { evidenceRemoved: number };
      await load();
      toast.success(excluded ? (done.evidenceRemoved > 0 ? `Excluded. ${done.evidenceRemoved} learned ${done.evidenceRemoved === 1 ? 'reply was' : 'replies were'} removed.` : 'Excluded from learning') : 'Learning allowed again for new replies');
    } catch (err) {
      toast.error(getApiError(err, 'Could not change learning for this conversation'));
    } finally {
      setSaving(false);
    }
  };

  if (failed) return <span className="hidden sm:inline text-[11px] text-gray-400" title="Digital Self choices could not be loaded">Style unavailable</span>;
  if (!list || !current) return null;

  const active = current.digitalSelf;
  const label = active ? active.name : 'Default';
  const excluded = current.learning.excluded;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={excluded ? 'Choose whose writing style Verz AI uses. Digital Self learning is off for this conversation.' : 'Choose whose writing style Verz AI uses in this conversation'}
        className="h-8 px-2.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors flex items-center gap-1.5"
      >
        <Sparkles size={13} />
        <span className="hidden sm:inline max-w-[8rem] truncate">Style: {label}</span>
        {excluded && (
          <>
            <EyeOff size={12} className="text-amber-600" aria-hidden="true" />
            <span className="hidden md:inline text-[11px] font-medium text-amber-700">Not learning</span>
            <span className="sr-only md:hidden">Learning is off for this conversation</span>
          </>
        )}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div role="listbox" aria-label="AI reply style" className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-1.5">
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-gray-500">
            Sets how Verz AI writes here. It does not change who owns the conversation or turn AI replies on.
          </p>
          {!list.featureEnabled && (
            <p className="mx-1.5 mb-1 px-2 py-1.5 rounded-lg bg-amber-50 text-[11px] text-amber-700">
              Digital Self is not switched on for this workspace yet, so your choice is saved but replies are not affected.
            </p>
          )}
          {current.source === 'owner' && active && (
            <p className="px-2.5 pb-1 text-[11px] text-gray-500">Using {active.name}&apos;s style because they own this conversation.</p>
          )}

          <Option selected={current.source !== 'assigned'} disabled={!canEdit || saving} onClick={() => void choose(null)} title="Default" detail="Owner's style if a person owns it, otherwise Verz AI's usual voice" />
          {list.items.map((ds) => (
            <Option
              key={ds.id}
              selected={current.source === 'assigned' && active?.id === ds.id}
              disabled={!canEdit || saving || !ds.assignable}
              onClick={() => void choose(ds.id)}
              title={ds.name}
              detail={ds.assignable ? STATUS_LABEL[ds.status] : 'Not available (deactivated or not active in this workspace)'}
            />
          ))}
          <div className="mt-1 pt-1.5 border-t border-gray-100 px-2.5 pb-1">
            <label className={cn('flex items-start gap-2 text-[12px] text-gray-700', (!canEdit || saving) && 'opacity-60')}>
              <input
                type="checkbox"
                className="mt-0.5 accent-teal-600"
                checked={excluded}
                disabled={!canEdit || saving}
                onChange={(e) => void setExclusion(e.target.checked)}
              />
              <span>
                <span className="block font-medium">Don&apos;t learn from this conversation</span>
                <span className="block text-[11px] text-gray-500">
                  {excluded
                    ? current.learning.excludedAt ? `Excluded on ${new Date(current.learning.excludedAt).toLocaleDateString()}. Agents\' replies here are not learned from.` : 'Agents\' replies here are not learned from.'
                    : 'Keeps agents\' replies here out of every Digital Self, and removes anything already learned from them.'}
                </span>
              </span>
            </label>
          </div>
          {!canEdit && <p className="px-2.5 py-1.5 text-[11px] text-gray-400">Only an admin or the conversation owner can change this.</p>}
          {saving && <div className="flex justify-center py-1"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
        </div>
      )}
    </div>
  );
}

function Option({ selected, disabled, onClick, title, detail }: { selected: boolean; disabled: boolean; onClick: () => void; title: string; detail: string }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn('w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg transition-colors', selected ? 'bg-teal-50' : 'hover:bg-gray-50', disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent')}
    >
      <span className="w-4 pt-0.5 flex-shrink-0">{selected && <Check size={14} className="text-teal-600" />}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-800 truncate">{title}</span>
        <span className="block text-[11px] text-gray-500">{detail}</span>
      </span>
    </button>
  );
}
