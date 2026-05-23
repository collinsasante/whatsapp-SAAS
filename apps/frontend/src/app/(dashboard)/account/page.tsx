'use client';
import { useState, useEffect } from 'react';
import { User, Mail, Lock, Shield, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { UserRole } from '@whatsapp-platform/shared-types';

const ROLE_LABELS: Record<UserRole, { label: string; color: string }> = {
  [UserRole.SUPER_ADMIN]: { label: 'Super Admin', color: 'bg-purple-100 text-purple-700' },
  [UserRole.ADMIN]:       { label: 'Admin',        color: 'bg-blue-100 text-blue-700' },
  [UserRole.AGENT]:       { label: 'Agent',        color: 'bg-teal-100 text-teal-700' },
  [UserRole.VIEWER]:      { label: 'Viewer',       color: 'bg-gray-100 text-gray-600' },
};

type AlertState = { type: 'success' | 'error'; message: string } | null;

function Alert({ state }: { state: AlertState }) {
  if (!state) return null;
  const isSuccess = state.type === 'success';
  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
      isSuccess ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'
    }`}>
      {isSuccess ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
      {state.message}
    </div>
  );
}

export default function AccountPage() {
  const { user, updateUser } = useAuthStore();

  // Profile form
  const [name, setName] = useState(user?.name ?? '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAlert, setProfileAlert] = useState<AlertState>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwAlert, setPwAlert] = useState<AlertState>(null);

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const userInitials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const roleInfo = user?.role ? ROLE_LABELS[user.role] : null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.name) return;
    setProfileLoading(true);
    setProfileAlert(null);
    try {
      const res = await authApi.updateMe({ name: trimmed });
      const updated = (res.data as { name: string });
      updateUser({ name: updated.name });
      setProfileAlert({ type: 'success', message: 'Profile updated.' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setProfileAlert({ type: 'error', message: msg ?? 'Failed to update profile.' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwAlert({ type: 'error', message: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPwAlert({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    setPwLoading(true);
    setPwAlert(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwAlert({ type: 'success', message: 'Password changed successfully.' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPwAlert({ type: 'error', message: msg ?? 'Failed to change password.' });
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-gray-900">My Account</h1>

        {/* Profile card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
            <User size={16} className="text-teal-600" />
            <span className="font-semibold text-gray-800">Profile</span>
          </div>

          <div className="px-6 py-6 space-y-6">
            {/* Avatar + role */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full flex-shrink-0">
                {user?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-teal-600 text-white flex items-center justify-center text-xl font-bold">
                    {userInitials}
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{user?.name}</p>
                <p className="text-sm text-gray-500">{user?.email}</p>
                {roleInfo && (
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleInfo.color}`}>
                    {roleInfo.label}
                  </span>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Mail size={13} />
                    Email address
                  </span>
                </label>
                <div className="flex items-center gap-2 px-4 py-2.5 border border-gray-100 rounded-xl bg-gray-50 text-sm text-gray-500 select-all">
                  {user?.email}
                </div>
                <p className="text-xs text-gray-400 mt-1">Email cannot be changed.</p>
              </div>

              <Alert state={profileAlert} />

              <button
                type="submit"
                disabled={profileLoading || !name.trim() || name.trim() === user?.name}
                className="px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {profileLoading ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </div>
        </div>

        {/* Password card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
            <Lock size={16} className="text-teal-600" />
            <span className="font-semibold text-gray-800">Change password</span>
          </div>

          <form onSubmit={handleChangePassword} className="px-6 py-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Current password</label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <Alert state={pwAlert} />

            <button
              type="submit"
              disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword}
              className="px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pwLoading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>

        {/* Role info card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
            <Shield size={16} className="text-teal-600" />
            <span className="font-semibold text-gray-800">Role & permissions</span>
          </div>
          <div className="px-6 py-6">
            {roleInfo && (
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${roleInfo.color}`}>
                  {roleInfo.label}
                </span>
                <span className="text-sm text-gray-500">
                  {user?.role === UserRole.SUPER_ADMIN && 'Full access to all workspaces and platform settings.'}
                  {user?.role === UserRole.ADMIN && 'Full access to this workspace including settings and billing.'}
                  {user?.role === UserRole.AGENT && 'Can handle conversations in the inbox.'}
                  {user?.role === UserRole.VIEWER && 'Read-only access to inbox and contacts.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
