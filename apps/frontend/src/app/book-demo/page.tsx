'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Calendar, Clock, Building2, User, Mail, Phone } from 'lucide-react';
import axios from 'axios';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Step = 1 | 2 | 3;

const BUSINESS_TYPES = ['E-commerce', 'Retail', 'Healthcare', 'Education', 'Finance', 'Hospitality', 'Real Estate', 'Logistics', 'Agency / Marketing', 'SaaS / Tech', 'Other'];
const COMPANY_SIZES = ['1-5', '6-20', '21-100', '101-500', '500+'];
const PLATFORMS = ['None', 'WhatsApp Business', 'AiSensy', 'Respond.io', 'Interakt', 'WATI', 'Zoko', 'Twilio', 'Other'];
const TIMES = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
const TIMEZONES = [
  'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Europe/London', 'Europe/Paris', 'Asia/Dubai', 'Asia/Kolkata',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
];

function minDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function maxDate() {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().split('T')[0];
}

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
}

const STEP_LABELS = ['Contact info', 'Business details', 'Schedule'];

export default function BookDemoPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    workEmail: '',
    phoneNumber: '',
    businessName: '',
    businessType: '',
    companySize: '',
    currentPlatform: '',
    preferredDate: '',
    preferredTime: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos',
    goals: '',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  async function fetchSlots(date: string) {
    if (!date || isWeekend(date)) { setSlots([]); return; }
    setLoadingSlots(true);
    try {
      const { data } = await axios.get<string[]>(`${API}/demo/slots`, { params: { date } });
      setSlots(data);
    } catch {
      setSlots(TIMES);
    } finally {
      setLoadingSlots(false);
    }
  }

  function validateStep(s: Step): string {
    if (s === 1) {
      if (!form.fullName.trim()) return 'Full name is required';
      if (!form.workEmail.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(form.workEmail)) return 'Valid email is required';
      if (!form.businessName.trim()) return 'Business name is required';
    }
    if (s === 2) {
      if (!form.businessType) return 'Please select your business type';
      if (!form.companySize) return 'Please select your company size';
    }
    if (s === 3) {
      if (!form.preferredDate) return 'Please select a date';
      if (isWeekend(form.preferredDate)) return 'Please select a weekday';
      if (!form.preferredTime) return 'Please select a time slot';
    }
    return '';
  }

  function next() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    if (step < 3) setStep((s) => (s + 1) as Step);
  }

  async function submit() {
    const err = validateStep(3);
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError('');
    try {
      await axios.post(`${API}/demo`, {
        fullName: form.fullName,
        workEmail: form.workEmail,
        phoneNumber: form.phoneNumber || undefined,
        businessName: form.businessName,
        businessType: form.businessType,
        companySize: form.companySize,
        currentPlatform: form.currentPlatform || undefined,
        preferredDate: form.preferredDate,
        preferredTime: form.preferredTime,
        timezone: form.timezone,
        goals: form.goals || undefined,
      });
      setDone(true);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#f0fdf4] border-2 border-[#bbf7d0] rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-[#16a34a]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">You&apos;re all booked!</h1>
          <p className="text-gray-500 mb-2">
            We&apos;ve confirmed your demo for{' '}
            <strong className="text-gray-700">
              {new Date(form.preferredDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </strong>{' '}
            at <strong className="text-gray-700">{form.preferredTime}</strong>.
          </p>
          <p className="text-gray-400 text-sm mb-8">Check your inbox — we sent a confirmation to <strong>{form.workEmail}</strong>.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-[#104a25] text-white font-semibold rounded-xl text-sm hover:bg-[#0d3d1e] transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium">
          <ArrowLeft size={16} />
          Back
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="VerzChat" className="h-8" />
        <div className="w-16" />
      </div>

      <div className="max-w-2xl mx-auto px-5 py-10">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Book a demo</h1>
          <p className="text-gray-500">See how VerzChat can transform your customer conversations.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                s === step ? 'bg-[#104a25] text-white' :
                s < step ? 'bg-[#f0fdf4] text-[#16a34a] border border-[#bbf7d0]' :
                'bg-gray-100 text-gray-400'
              }`}>
                {s < step ? <Check size={11} /> : <span>{s}</span>}
                <span className="hidden sm:inline">{STEP_LABELS[s - 1]}</span>
              </div>
              {s < 3 && <div className={`w-8 h-px ${s < step ? 'bg-[#16a34a]' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Contact */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-1">
                  <User size={18} className="text-[#104a25]" /> Contact information
                </h2>
                <p className="text-sm text-gray-400">Tell us who we&apos;re meeting with.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name <span className="text-red-400">*</span></label>
                <input
                  type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)}
                  placeholder="Sarah Johnson"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Work email <span className="text-red-400">*</span></label>
                <input
                  type="email" value={form.workEmail} onChange={(e) => set('workEmail', e.target.value)}
                  placeholder="sarah@company.com"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Business name <span className="text-red-400">*</span></label>
                <input
                  type="text" value={form.businessName} onChange={(e) => set('businessName', e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1"><Phone size={13} /> Phone number <span className="text-gray-400 font-normal">(optional)</span></span>
                </label>
                <input
                  type="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)}
                  placeholder="+234 800 000 0000"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors"
                />
              </div>
            </div>
          )}

          {/* Step 2: Business */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-1">
                  <Building2 size={18} className="text-[#104a25]" /> Business details
                </h2>
                <p className="text-sm text-gray-400">Help us tailor the demo to your use case.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Business type <span className="text-red-400">*</span></label>
                <select
                  value={form.businessType} onChange={(e) => set('businessType', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors bg-white"
                >
                  <option value="">Select industry</option>
                  {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company size <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-5 gap-2">
                  {COMPANY_SIZES.map((s) => (
                    <button
                      key={s} type="button"
                      onClick={() => set('companySize', s)}
                      className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                        form.companySize === s
                          ? 'bg-[#104a25] text-white border-[#104a25]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#104a25]/40 hover:text-[#104a25]'
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Current platform <span className="text-gray-400 font-normal">(optional)</span></label>
                <select
                  value={form.currentPlatform} onChange={(e) => set('currentPlatform', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors bg-white"
                >
                  <option value="">Select platform</option>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  What are you hoping to achieve? <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.goals} onChange={(e) => set('goals', e.target.value)}
                  placeholder="e.g. Reduce response time, manage team inbox, run broadcast campaigns..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 3: Schedule */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-1">
                  <Calendar size={18} className="text-[#104a25]" /> Pick a time
                </h2>
                <p className="text-sm text-gray-400">Choose a date and slot that works for you (Mon–Fri).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Preferred date <span className="text-red-400">*</span></label>
                <input
                  type="date"
                  value={form.preferredDate}
                  min={minDate()}
                  max={maxDate()}
                  onChange={(e) => {
                    set('preferredDate', e.target.value);
                    set('preferredTime', '');
                    fetchSlots(e.target.value);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors"
                />
                {form.preferredDate && isWeekend(form.preferredDate) && (
                  <p className="text-xs text-red-500 mt-1.5">Please select a weekday (Mon–Fri).</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-1"><Clock size={13} /> Available slots <span className="text-red-400">*</span></span>
                </label>
                {loadingSlots ? (
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-11 rounded-xl bg-gray-100 animate-pulse" />
                    ))}
                  </div>
                ) : !form.preferredDate || isWeekend(form.preferredDate) ? (
                  <p className="text-sm text-gray-400 py-3">Select a weekday first.</p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-red-500 py-3">No slots available on this date. Please pick another.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {TIMES.map((t) => {
                      const avail = slots.includes(t);
                      return (
                        <button
                          key={t} type="button" disabled={!avail}
                          onClick={() => avail && set('preferredTime', t)}
                          className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                            form.preferredTime === t
                              ? 'bg-[#104a25] text-white border-[#104a25]'
                              : avail
                                ? 'bg-white text-gray-700 border-gray-200 hover:border-[#104a25]/40 hover:text-[#104a25]'
                                : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through'
                          }`}
                        >{t}</button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                <select
                  value={form.timezone} onChange={(e) => set('timezone', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#104a25]/20 focus:border-[#104a25] transition-colors bg-white"
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
            {step > 1 ? (
              <button
                type="button" onClick={() => { setStep((s) => (s - 1) as Step); setError(''); }}
                className="flex items-center gap-2 px-5 py-2.5 text-gray-500 hover:text-gray-900 font-medium text-sm transition-colors"
              >
                <ArrowLeft size={15} /> Back
              </button>
            ) : <div />}

            {step < 3 ? (
              <button
                type="button" onClick={next}
                className="flex items-center gap-2 px-6 py-3 bg-[#104a25] text-white font-semibold rounded-xl text-sm hover:bg-[#0d3d1e] transition-colors"
              >
                Continue <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button" onClick={submit} disabled={submitting}
                className="flex items-center gap-2 px-6 py-3 bg-[#25D366] hover:bg-[#1aad57] text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Booking…' : 'Confirm booking'} {!submitting && <Check size={15} />}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Questions? Email us at{' '}
          <a href="mailto:support@verzchat.com" className="underline hover:text-gray-600 transition-colors">support@verzchat.com</a>
        </p>
      </div>
    </div>
  );
}
