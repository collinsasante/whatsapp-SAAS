'use client';
import { useEffect, useState } from 'react';
import { StickyNote, X, ChevronDown, ChevronUp, FileText, ImageIcon, Route } from 'lucide-react';
import { conversationsApi, activityLogApi, contactsApi } from '@/lib/api';
import { MessageDirection, MessageType } from '@whatsapp-platform/shared-types';
import { useInboxStore } from '@/store/inbox.store';
import { getInitials, formatRelativeTime, getProxiedMediaUrl } from '@/lib/utils';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

function formatJourneyLabel(entry: { action: string; metadata: Record<string, unknown>; user?: { id: string; name: string } | null }): string | null {
  const who = entry.user?.name ?? null;
  switch (entry.action) {
    case 'CONVERSATION_CREATED': return 'Service Conversation Started';
    case 'CONVERSATION_RESOLVED': return who ? `Chat Closed by ${who}` : 'Chat Closed';
    case 'CONVERSATION_REOPENED': return who ? `Chat Reopened by ${who}` : 'Chat Reopened';
    case 'CONVERSATION_ARCHIVED': return who ? `Chat Archived by ${who}` : 'Chat Archived';
    case 'CONVERSATION_REQUESTED': return 'Support requested';
    case 'CONVERSATION_INTERVENED': return who ? `${who} intervened` : 'Agent intervened';
    case 'CONVERSATION_TRANSFERRED': return entry.metadata?.toAgentName ? `Transferred to ${String(entry.metadata.toAgentName)}` : who ? `Transferred by ${who}` : 'Transferred';
    case 'CONVERSATION_ASSIGNED': return who ? `Transferred to ${who}` : 'Transferred';
    case 'CONVERSATION_UNASSIGNED': return who ? `Unassigned by ${who}` : 'Unassigned';
    case 'NOTE_ADDED': return who ? `Note added by ${who}` : 'Note added';
    case 'TAG_ADDED': return entry.metadata?.label ? `Label "${String(entry.metadata.label)}" added` : 'Label added';
    case 'TAG_REMOVED': return entry.metadata?.label ? `Label "${String(entry.metadata.label)}" removed` : 'Label removed';
    case 'CONTACT_UPDATED': return 'Contact updated';
    case 'CONTACT_BLOCKED': return 'Contact blocked';
    case 'MESSAGE_SENT': return null;
    case 'MESSAGE_DELETED': return null;
    case 'MESSAGE_STARRED': return null;
    default: return null;
  }
}

interface Conversation {
  id: string;
  contact: { id: string; name: string | null; phone: string; email?: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  labels: string[];
  lastMessageAt: string | null;
  createdAt?: string | null;
}

interface Props {
  conversation: Conversation;
}

interface ActivityEntry {
  id: string;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  user?: { id: string; name: string } | null;
}

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-emerald-100 text-emerald-700',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ConversationDetails({ conversation }: Props) {
  const { updateConversation, messages } = useInboxStore();
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const [voiceNotesExpanded, setVoiceNotesExpanded] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [journeyExpanded, setJourneyExpanded] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [contactDetail, setContactDetail] = useState<{ optedOut: boolean; isBlocked: boolean } | null>(null);

  const convMessages = messages[conversation.id] ?? [];
  const docMessages = convMessages.filter((m) => m.type === 'DOCUMENT' && m.mediaUrl);
  const mediaMessages = convMessages.filter((m) => (m.type === 'IMAGE' || m.type === 'VIDEO') && m.mediaUrl);
  const audioMessages = convMessages.filter((m) => m.type === 'AUDIO' && m.mediaUrl);
  const templateMessages = convMessages.filter((m) => m.type === MessageType.TEMPLATE);
  const sessionMessages = convMessages.filter((m) => m.type !== MessageType.TEMPLATE);
  const firstMessage = convMessages.length > 0 ? convMessages[0] : null;
  const lastInbound = [...convMessages].reverse().find((m) => m.direction === MessageDirection.INBOUND);
  const waConvActive = lastInbound && (Date.now() - new Date(lastInbound.createdAt).getTime()) < 24 * 60 * 60 * 1000;
  const mauActive = convMessages.some((m) => (Date.now() - new Date(m.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000);

  useEffect(() => {
    void activityLogApi.forConversation(conversation.id).then((res) => {
      setActivityLog((res.data as ActivityEntry[]) ?? []);
      setActivityLoaded(true);
    }).catch(() => { setActivityLoaded(true); });
    if (conversation.contact?.id) {
      void contactsApi.get(conversation.contact.id).then((res) => {
        const c = res.data as { optedOut: boolean; isBlocked: boolean };
        setContactDetail({ optedOut: c.optedOut, isBlocked: c.isBlocked });
      }).catch(() => {});
    }
  }, [conversation.id, conversation.contact?.id]);

  const removeLabel = async (label: string) => {
    try {
      const updated = conversation.labels.filter((l) => l !== label);
      await conversationsApi.update(conversation.id, { labels: updated });
      updateConversation(conversation.id, { labels: updated });
    } catch { toast.error('Failed to remove label'); }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await conversationsApi.addNote(conversation.id, noteText);
      setNoteText('');
      toast.success('Note added');
    } catch { toast.error('Failed to add note'); }
    finally { setAddingNote(false); }
  };

  const name = conversation.contact?.name ?? conversation.contact?.phone ?? 'Unknown';
  const avatarColor = getAvatarColor(name);

  return (
    <div className="w-72 border-l border-gray-100 bg-white flex flex-col overflow-y-auto flex-shrink-0">
      {/* Contact avatar + info */}
      <div className="flex flex-col items-center py-6 px-5 border-b border-gray-100">
        <div className={cn('w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold mb-3', avatarColor)}>
          {getInitials(name)}
        </div>
        <p className="font-semibold text-gray-900 text-base">{name}</p>
        <p className="text-sm text-gray-500 mt-0.5">{conversation.contact?.phone}</p>
        {conversation.contact?.email && <p className="text-xs text-gray-400 mt-0.5">{conversation.contact.email}</p>}
        {conversation.lastMessageAt && (
          <p className="text-xs text-gray-400 mt-2">Last seen {formatRelativeTime(conversation.lastMessageAt)}</p>
        )}
      </div>

      {/* Conversation Info */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setInfoExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-900">Conversation Info</span>
          {infoExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {infoExpanded && (
          <div className="px-5 pb-4 space-y-2">
            {([
              { label: 'Status', value: conversation.status },
              { label: 'Intervened', value: conversation.assignedTo ? 'Yes' : 'No' },
              { label: 'Transferred To', value: conversation.assignedTo?.name ?? '—' },
              { label: 'Last Active', value: conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—' },
              { label: 'Template Messages', value: String(templateMessages.length) },
              { label: 'Session Messages', value: String(sessionMessages.length) },
              { label: 'Unresolved Queries', value: '0' },
              { label: 'Source', value: 'ORGANIC' },
              { label: 'First Message', value: firstMessage ? new Date(firstMessage.createdAt as unknown as string).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—' },
              { label: 'WA Conversation', value: waConvActive ? 'Active' : 'Inactive', color: waConvActive ? 'text-green-600' : 'text-gray-500' },
              { label: 'MAU Status', value: mauActive ? 'Active' : 'Inactive', color: mauActive ? 'text-green-600' : 'text-gray-500' },
              { label: 'Incoming', value: contactDetail == null ? '—' : contactDetail.isBlocked ? 'Blocked' : 'Allowed', color: contactDetail?.isBlocked ? 'text-red-500' : 'text-green-600' },
              { label: 'Opted In', value: contactDetail == null ? '—' : contactDetail.optedOut ? 'No' : 'Yes', color: contactDetail?.optedOut ? 'text-red-500' : 'text-green-600' },
            ] as { label: string; value: string; color?: string }[]).map(({ label, value, color }) => (
              <div key={label} className="flex items-start justify-between gap-2 py-0.5">
                <span className="text-xs text-gray-400 shrink-0">{label}</span>
                <span className={cn('text-xs font-medium text-right', color ?? 'text-gray-800')}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer Journey */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setJourneyExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Route size={14} className="text-gray-400" /> Customer Journey
          </span>
          {journeyExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {journeyExpanded && (
          <div className="px-5 pb-4">
            {activityLog.length === 0 && activityLoaded ? (
              <p className="text-xs text-gray-400 text-center py-2">No activity yet</p>
            ) : !activityLoaded ? (
              <p className="text-xs text-gray-400 text-center py-2">Loading...</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-200" />
                <div className="space-y-4 pl-5">
                  {[...activityLog].reverse().map((entry) => {
                    const label = formatJourneyLabel(entry);
                    if (!label) return null;
                    const d = new Date(entry.createdAt);
                    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    const dateStr = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
                    return (
                      <div key={entry.id} className="relative">
                        <div className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-teal-400 border-2 border-white" />
                        <p className="text-xs font-medium text-gray-800 leading-snug">{label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{timeStr}, {dateStr}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Labels display */}
      {conversation.labels.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-1.5">
          {conversation.labels.map((label) => (
            <span key={label} className="flex items-center gap-1 text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full">
              {label}
              <button onClick={() => { void removeLabel(label); }} className="hover:text-teal-900 ml-0.5">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Files section */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setFilesExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-900">File</span>
          {filesExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {filesExpanded && (
          <div className="px-4 pb-3">
            {docMessages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No files shared yet</p>
            ) : (
              <div className="space-y-2">
                {docMessages.slice(0, 5).map((msg) => (
                  <a
                    key={msg.id}
                    href={getProxiedMediaUrl(msg.mediaUrl) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-xl transition-colors group"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText size={14} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{msg.mediaCaption ?? 'Document'}</p>
                      <p className="text-xs text-gray-400">{formatRelativeTime(msg.createdAt)}</p>
                    </div>
                  </a>
                ))}
                {docMessages.length > 5 && (
                  <button className="w-full py-2 text-xs text-teal-600 font-medium hover:bg-teal-50 rounded-xl transition-colors">
                    View all
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Media section */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setMediaExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-900">Media</span>
          {mediaExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {mediaExpanded && (
          <div className="px-4 pb-4">
            {mediaMessages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No media shared yet</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {mediaMessages.slice(0, 5).map((msg) => (
                  <a key={msg.id} href={getProxiedMediaUrl(msg.mediaUrl) || '#'} target="_blank" rel="noopener noreferrer"
                    className="aspect-square rounded-xl overflow-hidden bg-gray-100 block relative group">
                    {msg.type === 'IMAGE' && getProxiedMediaUrl(msg.mediaUrl) ? (
                      <img src={getProxiedMediaUrl(msg.mediaUrl)} alt="" className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-200">
                        <ImageIcon size={16} className="text-gray-400" />
                      </div>
                    )}
                  </a>
                ))}
                {mediaMessages.length > 5 && (
                  <div className="aspect-square rounded-xl bg-gray-800 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">+{mediaMessages.length - 5}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      {/* Voice Notes section */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setVoiceNotesExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-900">Voice Notes</span>
          {voiceNotesExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {voiceNotesExpanded && (
          <div className="px-4 pb-3">
            {audioMessages.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No voice notes yet</p>
            ) : (
              <div className="space-y-2">
                {audioMessages.slice(0, 10).map((msg) => (
                  <div key={msg.id} className="flex flex-col gap-1 p-2 hover:bg-gray-50 rounded-xl transition-colors">
                    <audio
                      src={getProxiedMediaUrl(msg.mediaUrl) || ''}
                      controls
                      className="w-full h-8"
                      style={{ minWidth: 0 }}
                    />
                    <p className="text-xs text-gray-400">{formatRelativeTime(msg.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="p-4 flex-1">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <StickyNote size={12} />
          Internal Note
        </h4>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Use @ to mention a team member…"
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none bg-gray-50"
        />
        <button
          onClick={() => { void addNote(); }}
          disabled={!noteText.trim() || addingNote}
          className="mt-2 w-full py-2 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors font-medium"
        >
          {addingNote ? 'Adding...' : 'Add Note'}
        </button>
      </div>
    </div>
  );
}
