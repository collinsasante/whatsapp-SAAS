'use client';
import { useEffect, useState } from 'react';
import { Sparkles, X, ChevronRight } from 'lucide-react';
import { publicApi } from '@/lib/api';

interface VersionInfo {
  version: string;
  channel: string;
  releasedAt: string;
  changelog?: {
    features?: string[];
    improvements?: string[];
    fixes?: string[];
    breaking?: string[];
    security?: string[];
  };
}

const STORAGE_KEY = 'verzchat_last_seen_version';

function Section({ emoji, label, items, color }: { emoji: string; label: string; items?: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <div className="mb-4">
      <p className={`text-xs font-semibold mb-2 ${color}`}>{emoji} {label}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
            <ChevronRight size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatsNewModal() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') return;
    publicApi.currentVersion()
      .then((res) => {
        const v = res.data as VersionInfo;
        const lastSeen = localStorage.getItem(STORAGE_KEY);
        if (v?.version && v.version !== lastSeen) {
          setInfo(v);
        }
      })
      .catch(() => null);
  }, []);

  const dismiss = () => {
    if (info?.version) localStorage.setItem(STORAGE_KEY, info.version);
    setInfo(null);
  };

  if (!info) return null;

  const cl = info.changelog;
  const hasChangelog = cl && (cl.features?.length || cl.improvements?.length || cl.fixes?.length || cl.security?.length || cl.breaking?.length);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={dismiss}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">What&apos;s New</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-mono font-semibold text-teal-600">v{info.version}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(info.releasedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  {info.channel !== 'stable' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium capitalize">
                      {info.channel}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={dismiss} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Changelog */}
        <div className="p-6">
          {hasChangelog ? (
            <>
              <Section emoji="✨" label="New Features" items={cl?.features} color="text-teal-700" />
              <Section emoji="⚡" label="Improvements" items={cl?.improvements} color="text-blue-700" />
              <Section emoji="🐛" label="Bug Fixes" items={cl?.fixes} color="text-green-700" />
              <Section emoji="🔒" label="Security" items={cl?.security} color="text-purple-700" />
              {cl?.breaking?.length ? (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
                  <Section emoji="⚠️" label="Breaking Changes" items={cl?.breaking} color="text-red-700" />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">No changelog for this release.</p>
          )}

          <button
            onClick={dismiss}
            className="w-full mt-2 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
