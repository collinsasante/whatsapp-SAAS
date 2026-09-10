'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2, RotateCcw, ShoppingCart, ExternalLink, BadgeCheck } from 'lucide-react';
import { commerceTestChatApi, commerceOrdersApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { linkify } from '@/lib/linkify';
import toast from 'react-hot-toast';

interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string | null;
  createdAt: string;
}

interface OrderItem {
  id: string;
  productNameSnapshot: string;
  quantity: number;
  lineTotalMajorUnits: number;
}

interface Order {
  id: string;
  status: string;
  currency: string;
  totalMajorUnits: number;
  paystackReference: string | null;
  paystackCheckoutUrl: string | null;
  items?: OrderItem[];
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

const ORDER_STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_PAYMENT: 'bg-amber-50 text-amber-600',
  PAID: 'bg-green-50 text-green-600',
  FULFILLING: 'bg-blue-50 text-blue-600',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  REFUNDED: 'bg-red-50 text-red-600',
};

export default function CommerceChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const loadState = useCallback(async () => {
    try {
      const res = await commerceTestChatApi.getState();
      const data = res.data as { messages: ChatMessage[]; order: Order | null };
      setMessages(data.messages);
      setOrder(data.order);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load test chat'));
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
    setMessages(prev => [...prev, { id: `local-${Date.now()}`, direction: 'INBOUND', content: text, createdAt: new Date().toISOString() }]);
    try {
      const res = await commerceTestChatApi.send(text);
      const data = res.data as { response: string; order: Order | null };
      setMessages(prev => [...prev, { id: `local-r-${Date.now()}`, direction: 'OUTBOUND', content: data.response || '(no response)', createdAt: new Date().toISOString() }]);
      setOrder(data.order);
    } catch (e) {
      toast.error(apiErr(e, 'Message failed'));
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    try {
      await commerceTestChatApi.reset();
      setMessages([]);
      setOrder(null);
      toast.success('New conversation started');
    } catch (e) {
      toast.error(apiErr(e, 'Failed to reset'));
    }
  };

  const verifyPayment = async () => {
    if (!order) return;
    setVerifying(true);
    try {
      const res = await commerceOrdersApi.verifyPayment(order.id);
      const data = res.data as { verified: boolean; reason?: string; order: Order };
      if (data.verified) {
        toast.success('Payment verified with Paystack — order is PAID');
        setOrder(prev => (prev ? { ...prev, ...data.order } : data.order));
      } else {
        toast.error(data.reason || 'Payment not confirmed by Paystack yet');
      }
    } catch (e) {
      toast.error(apiErr(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  };

  const checkoutUrl = order?.paystackCheckoutUrl ?? null;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
              <MessageSquare size={18} className="text-green-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Test Chat</h1>
              <p className="text-xs text-gray-500">Chat as a customer with your commerce AI — real orders, real (test-mode) payments, no WhatsApp needed</p>
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

      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading conversation...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                Say hi like a customer would — try &quot;What do you sell?&quot; or &quot;How much is the Blue Denim Jacket?&quot;
              </div>
            ) : (
              messages.map(m => (
                <div key={m.id} className={cn('flex', m.direction === 'INBOUND' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'text-sm px-4 py-2 max-w-[75%] whitespace-pre-wrap rounded-2xl',
                    m.direction === 'INBOUND'
                      ? 'bg-teal-600 text-white rounded-tr-sm'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm',
                  )}>
                    {m.content ? linkify(m.content) : m.content}
                  </div>
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
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
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

        {/* Order side panel */}
        <div className="hidden md:flex w-80 border-l border-gray-100 bg-white flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ShoppingCart size={15} className="text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">Current order</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!order ? (
              <p className="text-xs text-gray-400">
                No order yet in this conversation. Ask to buy something and watch it appear here in real time.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <code className="text-xs text-gray-400">{order.id.slice(0, 8)}</code>
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium', ORDER_STATUS_STYLE[order.status] ?? 'bg-gray-100 text-gray-600')}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {order.items && order.items.length > 0 && (
                  <div className="space-y-2">
                    {order.items.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 truncate">{item.quantity}× {item.productNameSnapshot}</span>
                        <span className="text-gray-500 shrink-0 ml-2">{order.currency} {item.lineTotalMajorUnits}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-sm font-semibold border-t border-gray-100 pt-2">
                      <span className="text-gray-800">Total</span>
                      <span className="text-gray-900">{order.currency} {order.totalMajorUnits}</span>
                    </div>
                  </div>
                )}

                {order.status === 'PENDING_PAYMENT' && checkoutUrl && (
                  <div className="space-y-2">
                    <a
                      href={checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 w-full px-3 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-400 transition-colors font-medium"
                    >
                      <ExternalLink className="w-4 h-4" /> Pay with Paystack (test)
                    </a>
                    <button
                      onClick={verifyPayment}
                      disabled={verifying}
                      className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
                    >
                      {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                      I&apos;ve paid — verify now
                    </button>
                    <p className="text-[11px] text-gray-400">
                      Use a Paystack test card (e.g. 4084 0840 8408 4081, any future expiry, CVV 408). After paying, click verify — it asks Paystack directly.
                    </p>
                  </div>
                )}

                {order.status === 'PAID' && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
                    <BadgeCheck className="w-4 h-4" /> Paid & verified — GMV and take-rate recorded
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
