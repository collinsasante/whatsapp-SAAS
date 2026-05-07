'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, UserPlus, Tag, StickyNote, X } from 'lucide-react';
import { conversationsApi, usersApi } from '@/lib/api';
import { useInboxStore } from '@/store/inbox.store';
import { getInitials, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string; email?: string | null };
  assignedTo: { id: string; name: string } | null;
  status: string;
  labels: string[];
  lastMessageAt: string | null;
}

interface Props {
  conversation: Conversation;
}

interface User {
  id: string;
  name: string;
  email: string;
}

export default function ConversationDetails({ conversation }: Props) {
  const { updateConversation } = useInboxStore();
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    if (showAssign && users.length === 0) {
      void usersApi.list().then((res) => setUsers(res.data as User[]));
    }
  }, [showAssign, users.length]);

  const resolve = async () => {
    try {
      await conversationsApi.resolve(conversation.id);
      updateConversation(conversation.id, { status: 'RESOLVED' });
      toast.success('Conversation resolved');
    } catch {
      toast.error('Failed to resolve conversation');
    }
  };

  const assignAgent = async (userId: string, userName: string) => {
    try {
      await conversationsApi.update(conversation.id, { assignedToId: userId });
      updateConversation(conversation.id, { assignedTo: { id: userId, name: userName } });
      setShowAssign(false);
      toast.success(`Assigned to ${userName}`);
    } catch {
      toast.error('Failed to assign agent');
    }
  };

  const unassign = async () => {
    try {
      await conversationsApi.update(conversation.id, { assignedToId: null });
      updateConversation(conversation.id, { assignedTo: null });
      toast.success('Unassigned');
    } catch {
      toast.error('Failed to unassign');
    }
  };

  const addLabel = async () => {
    const label = labelInput.trim();
    if (!label) return;
    const existing = conversation.labels ?? [];
    if (existing.includes(label)) { toast.error('Label already added'); return; }
    try {
      const updated = [...existing, label];
      await conversationsApi.update(conversation.id, { labels: updated });
      updateConversation(conversation.id, { labels: updated });
      setLabelInput('');
      setShowAddLabel(false);
      toast.success(`Label "${label}" added`);
    } catch {
      toast.error('Failed to add label');
    }
  };

  const removeLabel = async (label: string) => {
    try {
      const updated = conversation.labels.filter((l) => l !== label);
      await conversationsApi.update(conversation.id, { labels: updated });
      updateConversation(conversation.id, { labels: updated });
    } catch {
      toast.error('Failed to remove label');
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await conversationsApi.addNote(conversation.id, noteText);
      setNoteText('');
      toast.success('Note added');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setAddingNote(false);
    }
  };

  const name = conversation.contact.name ?? conversation.contact.phone;

  return (
    <div className="w-72 border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Conversation Details</h3>
        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xl mx-auto mb-2">
            {getInitials(name)}
          </div>
          <p className="font-semibold text-gray-900">{name}</p>
          <p className="text-sm text-gray-500">{conversation.contact.phone}</p>
          {conversation.contact.email && <p className="text-xs text-gray-400">{conversation.contact.email}</p>}
        </div>
        {conversation.assignedTo && (
          <p className="text-xs text-gray-400 text-center">Assigned to <span className="font-medium text-gray-600">{conversation.assignedTo.name}</span></p>
        )}
        {conversation.lastMessageAt && (
          <p className="text-xs text-gray-400 text-center mt-1">Last seen {formatRelativeTime(conversation.lastMessageAt)}</p>
        )}
      </div>

      <div className="p-4 border-b border-gray-100 space-y-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Actions</h4>

        <button
          onClick={() => { void resolve(); }}
          disabled={conversation.status === 'RESOLVED'}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <CheckCircle size={16} />
          {conversation.status === 'RESOLVED' ? 'Resolved' : 'Mark as Resolved'}
        </button>

        <div>
          <button
            onClick={() => { setShowAssign((v) => !v); setShowAddLabel(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <UserPlus size={16} />
            {conversation.assignedTo ? `Reassign (${conversation.assignedTo.name})` : 'Assign Agent'}
          </button>
          {showAssign && (
            <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden text-sm bg-white shadow-sm">
              {conversation.assignedTo && (
                <button onClick={() => { void unassign(); }} className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 transition-colors">
                  Remove assignment
                </button>
              )}
              {users.length === 0
                ? <p className="px-3 py-2 text-gray-400 text-xs">Loading...</p>
                : users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { void assignAgent(u.id, u.name); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center gap-2"
                  >
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-semibold shrink-0">
                      {getInitials(u.name)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => { setShowAddLabel((v) => !v); setShowAssign(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Tag size={16} />
            Add Label
          </button>
          {showAddLabel && (
            <div className="mt-1 flex gap-1">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { void addLabel(); } }}
                placeholder="Label name..."
                autoFocus
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button onClick={() => { void addLabel(); }} className="px-2 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700">Add</button>
            </div>
          )}
        </div>
      </div>

      {conversation.labels.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Labels</h4>
          <div className="flex flex-wrap gap-1.5">
            {conversation.labels.map((label) => (
              <span key={label} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {label}
                <button onClick={() => { void removeLabel(label); }} className="hover:text-blue-900 ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 flex-1">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1">
          <StickyNote size={12} />
          Add Note
        </h4>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add an internal note..."
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
        <button
          onClick={() => { void addNote(); }}
          disabled={!noteText.trim() || addingNote}
          className="mt-2 w-full py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {addingNote ? 'Adding...' : 'Add Note'}
        </button>
      </div>
    </div>
  );
}
