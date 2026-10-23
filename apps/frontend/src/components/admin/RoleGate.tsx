'use client';
import { useAdmin } from './AdminProvider';

/**
 * For pages whose controls are all changes (plans, pricing, flags, admins). Anyone who is not a super admin can read the
 * page, but every button and field inside is switched off, and a note says why. The server refuses these changes for
 * other roles anyway; this stops the page offering something that cannot work.
 */
export function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin, status } = useAdmin();
  const locked = status === 'ready' && !isSuperAdmin;
  return (
    <>
      {locked && (
        <p role="note" className="text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md px-3 py-2 mb-4">
          Only a super admin can change anything on this page. You can look at everything, and the controls are turned off for your role.
        </p>
      )}
      <fieldset disabled={locked} className="contents border-0 p-0 m-0 min-w-0">{children}</fieldset>
    </>
  );
}
