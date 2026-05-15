'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';

interface InviteInfo {
  email: string;
  name: string | null;
  role: string;
  expiresAt: string;
  workspace: { id: string; name: string; slug: string };
  inviterName: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager',
  AGENT: 'Agent', ANALYST: 'Analyst', VIEWER: 'Viewer',
};

const INPUT = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white transition-colors';

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { setAuth, user: currentUser } = useAuthStore();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Verify the token on mount
  useEffect(() => {
    void authApi.verifyInvite(token)
      .then((r) => {
        const data = r.data as InviteInfo;
        setInvite(data);
        if (data.name) setName(data.name);
      })
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setLoadError(msg ?? 'This invitation is invalid or has expired.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    if (!invite) return;
    setSubmitting(true);
    try {
      const needsAccount = !currentUser || currentUser.email !== invite.email;
      const res = await authApi.acceptInvite(
        token,
        needsAccount ? name : undefined,
        needsAccount ? password : undefined,
      );
      const data = res.data as {
        accessToken: string;
        user: { id: string; email: string; name: string; role: string; tenantId: string };
        tenant: { id: string; name: string; slug: string };
      };
      setAuth(
        { ...data.user, role: data.user.role as never },
        data.tenant,
        data.accessToken,
      );
      toast.success(`Welcome to ${invite.workspace.name}!`);
      router.push('/dashboard');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to accept invitation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">Invitation invalid</h1>
          <p className="text-sm text-gray-500 mb-6">{loadError}</p>
          <a href="/login" className="text-sm text-teal-600 hover:underline">Go to login</a>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  const isExistingUser = currentUser && currentUser.email === invite.email;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
        {/* Workspace badge */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-teal-600 flex items-center justify-center text-white font-bold text-lg">
            {invite.workspace.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">You&apos;ve been invited to</p>
            <p className="text-base font-bold text-gray-900">{invite.workspace.name}</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          <span className="font-medium text-gray-900">{invite.inviterName}</span> invited{' '}
          <span className="font-medium text-gray-900">{invite.email}</span> to join as{' '}
          <span className="inline-block px-2 py-0.5 bg-teal-50 text-teal-700 rounded-full text-xs font-semibold">
            {ROLE_LABELS[invite.role] ?? invite.role}
          </span>
        </p>

        {isExistingUser ? (
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mb-6">
            <p className="text-sm text-teal-700">
              You&apos;re already signed in as <strong>{currentUser.email}</strong>. Click below to join the workspace.
            </p>
          </div>
        ) : (
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Create a password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a secure password"
                className={INPUT}
              />
            </div>
            <p className="text-xs text-gray-400">
              You&apos;ll sign in with <strong>{invite.email}</strong> and this password.
            </p>
          </div>
        )}

        <button
          onClick={() => { void handleAccept(); }}
          disabled={submitting || (!isExistingUser && (!name.trim() || !password.trim()))}
          className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Joining…' : `Join ${invite.workspace.name}`}
        </button>

        {!isExistingUser && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Already have an account?{' '}
            <a href="/login" className="text-teal-600 hover:underline">Sign in first</a>
          </p>
        )}
      </div>
    </div>
  );
}
