'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  // Only redirect once — on the initial hydration check.
  // The login page handles its own redirect after a fresh login so this
  // effect must not re-fire when isAuthenticated changes mid-session.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (checkedRef.current) return;
    checkedRef.current = true;
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [_hasHydrated, isAuthenticated, router]);
  return (
    <div className="force-light min-h-screen flex bg-white">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[52%] bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 relative overflow-hidden flex-col justify-between p-14">
        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 bg-white/5 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/[0.03] rounded-full" />

        {/* Logo */}
        <div className="relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.svg" alt="VerzChat" className="h-9" />
        </div>

        {/* Main copy */}
        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-snug mb-4">
            All your customer<br />conversations,<br />one smart inbox.
          </h2>
          <p className="text-white/65 text-base mb-10 leading-relaxed">
            The WhatsApp Business platform built for growing teams — send campaigns, automate responses, and close deals faster.
          </p>
          <div className="space-y-3.5">
            {[
              'Shared team inbox with real-time updates',
              'Broadcast campaigns to thousands at once',
              'Automate replies with keyword triggers',
              'Analytics, CSAT, and audit logs',
            ].map((feat) => (
              <div key={feat} className="flex items-center gap-3">
                <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white fill-none stroke-current stroke-2" viewBox="0 0 12 12">
                    <polyline points="1.5,6 4.5,9 10.5,3" />
                  </svg>
                </div>
                <span className="text-white/85 text-sm">{feat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom testimonial card */}
        <div className="relative z-10 bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
          <div className="flex items-start gap-3">
            <div className="text-white/40 text-3xl leading-none mt-0.5">&ldquo;</div>
            <div>
              <p className="text-white/90 text-sm leading-relaxed">
                Our response time dropped from 4 hours to under 8 minutes after switching to this platform.
              </p>
              <div className="flex items-center gap-2.5 mt-3">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">S</div>
                <div>
                  <p className="text-white text-xs font-medium">Sara M.</p>
                  <p className="text-white/50 text-xs">Head of Support, GrowCo</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 min-h-screen">
        {children}
      </div>
    </div>
  );
}
