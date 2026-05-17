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
    <div className="min-h-screen flex bg-white">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[52%] bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 relative overflow-hidden flex-col justify-between p-14">
        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 bg-white/5 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/[0.03] rounded-full" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
            <svg className="w-6 h-6 text-white fill-current" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            </svg>
          </div>
          <span className="text-white text-lg font-bold tracking-tight">WA Platform</span>
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
