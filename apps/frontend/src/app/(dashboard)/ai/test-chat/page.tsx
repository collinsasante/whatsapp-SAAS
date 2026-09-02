'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2, RotateCcw, Sparkles, Clock } from 'lucide-react';
import { aiTestChatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface RawMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string | null;
  createdAt: string;
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
  kind: 'message' | 'suggestion' | 'note';
  confidence?: number | null;
  createdAt: string;
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
    .map((m) => ({ id: m.id, direction: m.direction, content: m.content!, kind: 'message', createdAt: m.createdAt }));
  const fromSuggestions: ChatEntry[] = suggestions.map((s) => ({
    id: s.id, direction: 'OUTBOUND', content: s.aiResponse, kind: 'suggestion', confidence: s.confidenceScore, createdAt: s.createdAt,
  }));
  return [...fromMessages, ...fromSuggestions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export default function AiTestChatPage() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, sending]);

  const loadState = useCallback(async () => {
    try {
      const res = await aiTestChatApi.getState();
      const data = res.data as { messages: RawMessage[]; suggestions: RawSuggestion[] };
      setEntries(mergeEntries(data.messages, data.suggestions));
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load test chat -- make sure Verz AI is enabled on the Settings tab first'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(); }, [loadState]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    const now = new Date().toISOString();
    setEntries((prev) => [...prev, { id: `local-${Date.now()}`, direction: 'INBOUND', content: text, kind: 'message', createdAt: now }]);
    try {
      const res = await aiTestChatApi.send(text);
      const data = res.data as {
        mode: 'SUGGESTION' | 'AUTO_REPLY' | 'TIMEOUT';
        suggestion: RawSuggestion | null;
        message: RawMessage | null;
        note?: string;
      };
      if (data.mode === 'AUTO_REPLY' && data.message) {
        setEntries((prev) => [...prev, { id: data.message!.id, direction: 'OUTBOUND', content: data.message!.content ?? '', kind: 'message', createdAt: data.message!.createdAt }]);
      } else if (data.mode === 'SUGGESTION' && data.suggestion) {
        setEntries((prev) => [...prev, { id: data.suggestion!.id, direction: 'OUTBOUND', content: data.suggestion!.aiResponse, kind: 'suggestion', confidence: data.suggestion!.confidenceScore, createdAt: data.suggestion!.createdAt }]);
      } else {
        setEntries((prev) => [...prev, { id: `note-${Date.now()}`, direction: 'OUTBOUND', content: data.note ?? 'No AI response.', kind: 'note', createdAt: new Date().toISOString() }]);
      }
    } catch (e) {
      toast.error(apiErr(e, 'Message failed'));
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    try {
      await aiTestChatApi.reset();
      setEntries([]);
      toast.success('New conversation started');
    } catch (e) {
      toast.error(apiErr(e, 'Failed to reset'));
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center">
              <MessageSquare size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Test Chat</h1>
              <p className="text-xs text-gray-500">
                Chat as a customer with Verz AI through the real message pipeline — no WhatsApp needed. In Suggestion mode replies are drafts only (not sent); in Auto-Reply mode they're real sent messages.
              </p>
            </div>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New conversation
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading conversation...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            Say hi like a customer would — try &quot;How much is delivery?&quot; or ask something from your knowledge base.
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
                    : e.kind === 'suggestion'
                      ? 'bg-violet-50 text-violet-900 rounded-tl-sm border border-dashed border-violet-300'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm',
              )}>
                {e.content}
              </div>
              {e.kind === 'suggestion' && (
                <span className="flex items-center gap-1 text-[11px] text-violet-500 mt-1 px-1">
                  <Sparkles size={10} /> Suggested — not sent{e.confidence !== null && e.confidence !== undefined ? ` (${e.confidence}% confidence)` : ''}
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
            disabled={sending}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white text-sm rounded-xl hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
