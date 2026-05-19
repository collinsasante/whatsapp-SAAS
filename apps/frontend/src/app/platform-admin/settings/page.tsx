'use client';
import { Settings } from 'lucide-react';

export default function AdminSettingsPage() {
  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform configuration</p>
      </div>

      <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-8 text-center">
        <Settings size={40} className="mx-auto text-slate-600 mb-3" />
        <p className="text-slate-400 text-sm">Settings panel coming soon</p>
      </div>
    </div>
  );
}
