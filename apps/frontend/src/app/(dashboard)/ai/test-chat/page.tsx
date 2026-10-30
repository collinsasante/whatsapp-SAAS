'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2, RotateCcw, Sparkles, Clock } from 'lucide-react';
import { aiTestChatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { linkify } from '@/lib/linkify';
import toast from 'react-hot-toast';
import { DigitalSelfPicker } from '@/components/shared/DigitalSelfPicker';

interface RawMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string | null;
  createdAt: string;
  /** A reply the test chat generated and stored but deliberately never sent to any channel carries metadata.simulated. */
  metadata?: { simulated?: boolean } | null;
}

interface RawSuggestion {
  id: string;
  status: string;
  aiResponse: string;
  confidenceScore: number | null;
  createdAt: string;
}

interface ChatEntry {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  kind: 'message' | 'suggestion' | 'note' | 'error';
  confidence?: number | null;
  /** Generated and stored, but not sent to any channel. */
  simulated?: boolean;
  createdAt: string;
}

interface UsageInfo {
  limits: { dailyRequests: number; userPerMinute: number; maxInputChars: number; maxConversationTurns: number };
  used: { requestsToday: number };
  resetsAt: string;
}

/** One id per send, kept across retries of that send. Matches the server's accepted shape (8-64 letters, digits, - or _). */
function newRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  return c && 'randomUUID' in c ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

function mergeEntries(messages: RawMessage[], suggestions: RawSuggestion[]): ChatEntry[] {
  const fromMessages: ChatEntry[] = messages
    .filter((m) => m.content)
    .map((m) => ({ id: m.id, direction: m.direction, content: m.content!, kind: 'message', simulated: m.direction === 'OUTBOUND' && m.metadata?.simulated === true, createdAt: m.createdAt }));
  // Only a draft is shown as a suggestion. A simulated reply is already shown as its stored message above; listing its log as well
  // would show every reply twice.
  const fromSuggestions: ChatEntry[] = suggestions.filter((s) => s.status === 'SUGGESTED').map((s) => ({
    id: s.id, direction: 'OUTBOUND', content: s.aiResponse, kind: 'suggestion', confidence: s.confidenceScore, createdAt: s.createdAt,
  }));
  return [...fromMessages, ...fromSuggestions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export default function AiTestChatPage() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, sending]);

  const loadState = useCallback(async () => {
    try {
      const res = await aiTestChatApi.getState();
      const data = res.data as { conversationId?: string; messages: RawMessage[]; suggestions: RawSuggestion[] };
      setConversationId(data.conversationId ?? null);
      setEntries(mergeEntries(data.messages, data.suggestions));
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load test chat -- make sure Verz AI is enabled on the Settings tab first'));
    } finally {
      setLoading(false);
    }
  }, []);

  // The allowance line is informational: if it cannot be loaded the chat still works (the server enforces the limits either way).
  const loadUsage = useCallback(async () => {
    try {
      const res = await aiTestChatApi.usage();
      setUsage(res.data as UsageInfo);
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => { void loadState(); void loadUsage(); }, [loadState, loadUsage]);

  const allowanceSpent = usage !== null && usage.used.requestsToday >= usage.limits.dailyRequests;

  const send = async () => {
    const text = input.trim();
    if (!text || sending || allowanceSpent) return;
    setInput('');
    setSending(true);
    const now = new Date().toISOString();
    const localId = `local-${Date.now()}`;
    setEntries((prev) => [...prev, { id: localId, direction: 'INBOUND', content: text, kind: 'message', createdAt: now }]);
    try {
      const res = await aiTestChatApi.send(text, newRequestId());
      const data = res.data as {
        mode: 'SUGGESTION' | 'SIMULATED' | 'TIMEOUT' | 'ERROR';
        suggestion: RawSuggestion | null;
        message: RawMessage | null;
        note?: string;
        replayed?: boolean;
      };
      if (data.replayed) toast('That message was already processed, so this is the earlier reply (nothing new was used).');
      if (data.mode === 'SIMULATED' && (data.message || data.suggestion)) {
        // Generated and stored, never sent. Prefer the stored message; fall back to the logged text if the message is missing.
        const m = data.message;
        const entry: ChatEntry = m
          ? { id: m.id, direction: 'OUTBOUND', content: m.content ?? '', kind: 'message', simulated: true, createdAt: m.createdAt }
          : { id: data.suggestion!.id, direction: 'OUTBOUND', content: data.suggestion!.aiResponse, kind: 'message', simulated: true, confidence: data.suggestion!.confidenceScore, createdAt: data.suggestion!.createdAt };
        setEntries((prev) => [...prev, entry]);
      } else if (data.mode === 'ERROR') {
        setEntries((prev) => [...prev, { id: `error-${Date.now()}`, direction: 'OUTBOUND', content: data.note ?? 'Something unexpected happened in the test chat.', kind: 'error', createdAt: new Date().toISOString() }]);
      } else if (data.mode === 'SUGGESTION' && data.suggestion) {
        setEntries((prev) => [...prev, { id: data.suggestion!.id, direction: 'OUTBOUND', content: data.suggestion!.aiResponse, kind: 'suggestion', confidence: data.suggestion!.confidenceScore, createdAt: data.suggestion!.createdAt }]);
      } else {
        setEntries((prev) => [...prev, { id: `note-${Date.now()}`, direction: 'OUTBOUND', content: data.note ?? 'No AI response.', kind: 'note', createdAt: new Date().toISOString() }]);
      }
    } catch (e) {
      // The server refused it (limit reached, store unavailable, too long, ...): it was never processed, so do not leave it in the
      // thread as if it had been sent, and give the text back so nothing the person typed is lost.
      setEntries((prev) => prev.filter((x) => x.id !== localId));
      setInput((current) => current || text);
      toast.error(apiErr(e, 'Message failed'));
    } finally {
      setSending(false);
      void loadUsage();
    }
  };

  const reset = async () => {
    try {
      const res = await aiTestChatApi.reset();
      // A new conversation is a new row, so the style choice starts fresh and the picker follows the new id.
      setConversationId((res.data as { conversationId?: string }).conversationId ?? null);
      setEntries([]);
      toast.success('New conversation started');
      void loadUsage();
    } catch (e) {
      toast.error(apiErr(e, 'Failed to reset'));
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
              <MessageSquare size={18} className="text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Test Chat</h1>
              <p className="text-xs text-gray-500">
                Chat as a customer with Verz AI through the real message pipeline. Nothing here is ever sent to WhatsApp, Messenger or Instagram: in Suggestion mode replies are drafts, and in Auto-Reply mode they are generated and shown as simulated replies.
              </p>
              {usage && (
                <p role={allowanceSpent ? 'alert' : undefined} className={cn('text-xs mt-1', allowanceSpent ? 'text-red-600' : usage.used.requestsToday >= usage.limits.dailyRequests * 0.9 ? 'text-amber-600' : 'text-gray-400')}>
                  {allowanceSpent
                    ? `Today's allowance of ${usage.limits.dailyRequests} test messages is used up, so sending is paused until it resets at 00:00 UTC. Real customer messages are not affected.`
                    : `${usage.used.requestsToday} of ${usage.limits.dailyRequests} test messages used today. The allowance resets at 00:00 UTC. Messages can be up to ${usage.limits.maxInputChars} characters, and a conversation up to ${usage.limits.maxConversationTurns} messages.`}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
          {/* Preview: pick a Digital Self, then chat. Replies use the real pipeline with that style and are never sent to a customer. */}
          {conversationId && <DigitalSelfPicker conversationId={conversationId} canEdit />}
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New conversation
          </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading conversation...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            Say hi like a customer would, try &quot;How much is delivery?&quot; or ask something from your knowledge base.
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={cn('flex flex-col', e.direction === 'INBOUND' ? 'items-end' : 'items-start')}>
              <div className={cn(
                'text-sm px-4 py-2 max-w-[75%] whitespace-pre-wrap rounded-2xl',
                e.direction === 'INBOUND'
                  ? 'bg-teal-600 text-white rounded-tr-sm'
                  : e.kind === 'note'
                    ? 'bg-amber-50 text-amber-700 rounded-tl-sm border border-amber-200'
                    : e.kind === 'error'
                      ? 'bg-red-50 text-red-700 rounded-tl-sm border border-red-200'
                    : e.kind === 'suggestion'
                      ? 'bg-purple-50 text-purple-900 rounded-tl-sm border border-dashed border-purple-300'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm',
              )}>
                {linkify(e.content)}
              </div>
              {e.kind === 'suggestion' && (
                <span className="flex items-center gap-1 text-[11px] text-purple-500 mt-1 px-1">
                  <Sparkles size={10} /> Suggested, not sent{e.confidence !== null && e.confidence !== undefined ? ` (${e.confidence}% confidence)` : ''}
                </span>
              )}
              {e.simulated && (
                <span className="flex items-center gap-1 text-[11px] text-gray-500 mt-1 px-1">
                  <Sparkles size={10} /> Simulated reply, not sent to any channel{e.confidence !== null && e.confidence !== undefined ? ` (${e.confidence}% confidence)` : ''}
                </span>
              )}
              {e.kind === 'note' && (
                <span className="flex items-center gap-1 text-[11px] text-amber-500 mt-1 px-1">
                  <Clock size={10} /> Check the AI Activity tab for a trace
                </span>
              )}
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 bg-white p-3 sm:p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Type as the customer..."
            maxLength={usage?.limits.maxInputChars}
            disabled={sending || allowanceSpent}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
          <button
            onClick={send}
            disabled={sending || allowanceSpent || !input.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white text-sm rounded-xl hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
