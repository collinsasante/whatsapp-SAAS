'use client';
import { useState, useEffect, useRef } from 'react';
import { User, Mail, Lock, Shield, CheckCircle, AlertCircle, Eye, EyeOff, Camera, KeyRound } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { authApi, mediaApi } from '@/lib/api';
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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwAlert, setPwAlert] = useState<AlertState>(null);

  // PIN form
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinAlert, setPinAlert] = useState<AlertState>(null);

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

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileAlert({ type: 'error', message: 'Please select an image file.' });
      return;
    }
    setAvatarUploading(true);
    setProfileAlert(null);
    try {
      const uploadRes = await mediaApi.upload(file);
      const { url } = uploadRes.data as { url: string };
      await authApi.updateMe({ avatarUrl: url });
      updateUser({ avatarUrl: url });
      setProfileAlert({ type: 'success', message: 'Profile photo updated.' });
    } catch {
      setProfileAlert({ type: 'error', message: 'Failed to upload photo.' });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
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

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(newPin)) {
      setPinAlert({ type: 'error', message: 'PIN must be 4–6 digits.' });
      return;
    }
    if (newPin !== confirmPin) {
      setPinAlert({ type: 'error', message: 'PINs do not match.' });
      return;
    }
    setPinLoading(true);
    setPinAlert(null);
    try {
      await authApi.changePin(currentPin || undefined, newPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setPinAlert({ type: 'success', message: 'Login PIN updated.' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPinAlert({ type: 'error', message: msg ?? 'Failed to update PIN.' });
    } finally {
      setPinLoading(false);
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
              {/* Clickable avatar with camera overlay */}
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="relative w-16 h-16 rounded-full flex-shrink-0 group"
                title="Change photo"
              >
                {user?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-teal-600 text-white flex items-center justify-center text-xl font-bold">
                    {userInitials}
                  </div>
                )}
                {/* Overlay */}
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {avatarUploading
                    ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Camera size={16} className="text-white" />
                  }
                </div>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
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

        {/* PIN card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center gap-3">
            <KeyRound size={16} className="text-teal-600" />
            <span className="font-semibold text-gray-800">Login PIN</span>
          </div>
          <form onSubmit={handleChangePin} className="px-6 py-6 space-y-4">
            <p className="text-sm text-gray-500">Your 4-digit PIN is used as a second factor every time you sign in.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Current PIN <span className="text-gray-400 text-xs">(leave blank if not set)</span></label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Current PIN"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent tracking-widest"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">New PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4–6 digits"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent tracking-widest"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm new PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Repeat new PIN"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent tracking-widest"
              />
            </div>
            <Alert state={pinAlert} />
            <button
              type="submit"
              disabled={pinLoading || !newPin || !confirmPin}
              className="px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pinLoading ? 'Updating…' : 'Update PIN'}
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
