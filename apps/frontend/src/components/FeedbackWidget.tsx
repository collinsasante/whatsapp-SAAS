'use client';
import { useState } from 'react';
import { MessageCircle, X, Loader2, Star, Bug, Lightbulb, CreditCard, HelpCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL' | 'BILLING';

const TYPES: { value: FeedbackType; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'BUG',             label: 'Bug report',     icon: Bug,        color: 'text-red-500' },
  { value: 'FEATURE_REQUEST', label: 'Feature idea',   icon: Lightbulb,  color: 'text-amber-500' },
  { value: 'BILLING',         label: 'Billing',        icon: CreditCard, color: 'text-blue-500' },
  { value: 'GENERAL',         label: 'General',        icon: HelpCircle, color: 'text-gray-500' },
];

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('GENERAL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setType('GENERAL');
    setSubject('');
    setBody('');
    setRating(0);
    setHovered(0);
    setDone(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      await api.post('/feedback', {
        type,
        subject: subject.trim() || undefined,
        body: body.trim(),
        rating: rating || undefined,
        page: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      setDone(true);
      setTimeout(() => { setOpen(false); reset(); }, 2000);
    } catch {
      toast.error('Failed to send feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-full shadow-lg transition-colors border border-gray-700"
      >
        <MessageCircle size={13} />
        Feedback
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end p-4 sm:p-6">
          <div className="fixed inset-0 bg-black/30" onClick={() => { setOpen(false); reset(); }} />
          <div className="relative bg-white border border-gray-200 rounded-2xl shadow-2xl w-full sm:w-96 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Send feedback</p>
              <button onClick={() => { setOpen(false); reset(); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={15} />
              </button>
            </div>

            {done ? (
              <div className="p-8 text-center">
                <div className="text-3xl mb-3">🙏</div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Thank you!</p>
                <p className="text-xs text-gray-500">Your feedback helps us build a better product.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="p-4 space-y-4">
                {/* Type selector */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Type</p>
                  <div className="grid grid-cols-2 gap-2">
                    {TYPES.map(({ value, label, icon: Icon, color }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setType(value)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          type === value
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={12} className={type === value ? 'text-white' : color} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                    placeholder="One line summary..."
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Details <span className="text-red-400">*</span></label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                    maxLength={4000}
                    rows={4}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 transition-colors resize-none"
                    placeholder={type === 'BUG' ? "What happened? What did you expect?" : "Tell us more..."}
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5 text-right">{body.length}/4000</p>
                </div>

                {/* Star rating */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">How would you rate your experience? <span className="text-gray-400">(optional)</span></p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onMouseEnter={() => setHovered(s)}
                        onMouseLeave={() => setHovered(0)}
                        onClick={() => setRating(s === rating ? 0 : s)}
                        className="transition-transform hover:scale-110"
                      >
                        <Star
                          size={18}
                          className={
                            s <= (hovered || rating)
                              ? 'text-amber-400 fill-amber-400'
                              : 'text-gray-300'
                          }
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !body.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                  Send feedback
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
