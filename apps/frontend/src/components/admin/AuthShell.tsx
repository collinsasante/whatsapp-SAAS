'use client';
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { detectEnvironment, type EnvironmentName } from './AdminProvider';
import { cn } from '@/lib/utils';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72;

/** Two-column sign-in layout. The left side says plainly what this place is and what is recorded. */
export function AuthShell({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const [env, setEnv] = useState<EnvironmentName | null>(null);
  useEffect(() => setEnv(detectEnvironment(window.location.hostname)), []);

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-white">
      <aside className="hidden lg:flex flex-col justify-between bg-[#0d1914] text-white p-10">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-md bg-green-500/90 flex items-center justify-center" aria-hidden="true"><ShieldCheck className="w-4 h-4 text-green-950" /></span>
          <span className="leading-tight"><span className="block text-sm font-semibold">VerzChat</span><span className="block text-xs text-green-200/60">Platform console</span></span>
        </div>
        <div className="max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight leading-snug">The controls for the whole platform, in one place.</h2>
          <ul className="mt-6 space-y-3 text-sm text-gray-300">
            <li className="flex gap-2.5"><Lock className="w-4 h-4 mt-0.5 text-green-300 shrink-0" aria-hidden="true" />For authorised VerzChat administrators only.</li>
            <li className="flex gap-2.5"><Lock className="w-4 h-4 mt-0.5 text-green-300 shrink-0" aria-hidden="true" />Every sign-in and every failed attempt is recorded.</li>
            <li className="flex gap-2.5"><Lock className="w-4 h-4 mt-0.5 text-green-300 shrink-0" aria-hidden="true" />Sensitive changes ask for a reason and are logged with your name.</li>
          </ul>
        </div>
        <p className="text-xs text-gray-500">Customer workspaces sign in at the main VerzChat address, not here.</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <span className="w-8 h-8 rounded-md bg-[#0d1914] flex items-center justify-center" aria-hidden="true"><ShieldCheck className="w-4 h-4 text-green-300" /></span>
            <span className="text-sm font-semibold text-gray-900">VerzChat Platform console</span>
          </div>
          {env && env !== 'Production' && (
            <p className={cn('inline-block mb-4 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', env === 'Staging' ? 'bg-amber-50 text-amber-800 ring-amber-600/25' : 'bg-gray-100 text-gray-700 ring-gray-500/25')}>
              {env} environment
            </p>
          )}
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{title}</h1>
          {description && <p className="text-sm text-gray-600 mt-1.5">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

export const inputClass = 'w-full text-sm border border-gray-300 rounded-md px-3 py-2.5 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600';

/** Password box with a show/hide button and a warning when Caps Lock is on. */
export function PasswordInput({ id, value, onChange, autoComplete, describedBy }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          id={id} type={show ? 'text' : 'password'} value={value} required autoComplete={autoComplete} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
          onBlur={() => setCaps(false)}
          className={cn(inputClass, 'pr-10')}
        />
        <button
          type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-800 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
        >
          {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      {caps && <p role="status" className="text-xs text-amber-700 mt-1">Caps Lock is on.</p>}
    </div>
  );
}
