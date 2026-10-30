'use client';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Gift, Pencil, PauseCircle, PlayCircle, Repeat } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDate, formatNumber } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { useAdmin } from '@/components/admin/AdminProvider';
import { CopyId, Tabs, type TabDef } from '@/components/admin/DetailParts';
import { ActionDialog } from '@/components/admin/ActionDialog';
import { AuditList } from '@/components/admin/AuditList';
import { ErrorState, ReadOnlyNotice, Skeleton } from '@/components/admin/States';
import { StatusPill, TenantStatus } from '@/components/admin/StatusPill';
import { Section } from '@/components/admin/PageHeader';
import { TenantOverviewTab } from '@/components/admin/tenant/TenantOverviewTab';
import { TenantMembersTab } from '@/components/admin/tenant/TenantMembersTab';
import { TenantSubscriptionTab } from '@/components/admin/tenant/TenantSubscriptionTab';
import { TenantAiTab } from '@/components/admin/tenant/TenantAiTab';
import { TenantChannelsTab } from '@/components/admin/tenant/TenantChannelsTab';
import { MAX_CREDIT_GRANT } from '@/lib/admin/limits';
import { cn } from '@/lib/utils';

type Dialog = null | 'suspend' | 'activate' | 'edit' | 'plan' | 'credits';

const inputCls = 'w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600';

function ActionButton({ icon: Icon, children, onClick, disabled, why, tone }: { icon: React.ElementType; children: React.ReactNode; onClick: () => void; disabled?: boolean; why?: string; tone?: 'danger' }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={disabled ? why : undefined}
      className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600',
        tone === 'danger' ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />{children}
    </button>
  );
}

export default function TenantDetailPage() {
  const id = String(useParams()?.['id'] ?? '');
  const { canChange, isSuperAdmin } = useAdmin();
  const url = useUrlState({ tab: 'overview' });
  const tab = url.get('tab');

  const tenant = useAdminData(() => adminApi.getWorkspace(id), [id]);
  const plans = useAdminData(() => adminApi.plans(), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  // Form state for the dialogs that have their own fields.
  const [name, setName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [planSlug, setPlanSlug] = useState('');
  const [credits, setCredits] = useState('');
  const [creditType, setCreditType] = useState<'BONUS' | 'ADJUSTMENT'>('BONUS');

  const data = tenant.data;
  const status = useMemo(() => {
    if (!data) return '';
    if (!data.isActive) return 'suspended';
    if (!data.subscription) return 'no_subscription';
    const s = data.subscription.status;
    return s === 'CANCELED' || s === 'EXPIRED' ? 'churned' : s.toLowerCase();
  }, [data]);

  if (tenant.error && !data) return <div><PageHeader title="Tenant" crumbs={[{ label: 'Tenants', href: '/platform-admin/workspaces' }, { label: 'Not found' }]} /><div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={tenant.error} onRetry={tenant.reload} /></div></div>;
  if (!data) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-96" /><Skeleton className="h-64 w-full" /></div>;

  const creditsN = Number(credits);
  const creditsOk = Number.isInteger(creditsN) && creditsN >= 1 && creditsN <= MAX_CREDIT_GRANT;
  const emailOk = billingEmail.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim());
  const chosenPlan = (plans.data ?? []).find((p) => p.slug === planSlug);

  const tabs: TabDef[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'members', label: 'Members', count: data._count.users },
    { key: 'subscription', label: 'Subscription and billing' },
    { key: 'ai', label: 'AI credits' },
    { key: 'channels', label: 'Channels', count: data.channels.length },
    { key: 'activity', label: 'Activity', count: data.auditLog.length },
  ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview';

  const refreshed = () => { tenant.reload(); };
  const openEdit = () => { setName(data.name); setBillingEmail(data.billingEmail ?? ''); setDialog('edit'); };
  const openPlan = () => { setPlanSlug(''); setDialog('plan'); };
  const openCredits = () => { setCredits(''); setCreditType('BONUS'); setDialog('credits'); };

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Tenants', href: '/platform-admin/workspaces' }, { label: data.name }]}
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TenantStatus status={status} />
            <CopyId value={data.id} label="Tenant ID" />
            <span className="text-xs text-gray-500">Signed up {formatDate(data.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <ActionButton icon={Pencil} onClick={openEdit} disabled={!canChange} why="Your role cannot edit tenants">Edit</ActionButton>
            <ActionButton icon={Gift} onClick={openCredits} disabled={!isSuperAdmin} why="Only a super admin can grant credits">Grant credits</ActionButton>
            <ActionButton icon={Repeat} onClick={openPlan} disabled={!isSuperAdmin} why="Only a super admin can assign a plan">Assign plan</ActionButton>
            {data.isActive
              ? <ActionButton icon={PauseCircle} tone="danger" onClick={() => setDialog('suspend')} disabled={!canChange} why="Your role cannot suspend tenants">Suspend</ActionButton>
              : <ActionButton icon={PlayCircle} onClick={() => setDialog('activate')} disabled={!canChange} why="Your role cannot reactivate tenants">Reactivate</ActionButton>}
          </>
        }
      />
      {!canChange && <ReadOnlyNotice />}
      {!data.isActive && (
        <p role="status" className="mb-4 text-sm text-red-900 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <StatusPill tone="danger" className="mr-2">Suspended</StatusPill>Nobody in this workspace can use it, and messages arriving through WhatsApp Cloud API, Messenger and Instagram are not processed. Nothing has been deleted.
        </p>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={(t) => url.set({ tab: t }, { keepPage: true })} label="Tenant sections" />

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'overview' && <TenantOverviewTab data={data} />}
        {activeTab === 'members' && <TenantMembersTab data={data} />}
        {activeTab === 'subscription' && <TenantSubscriptionTab data={data} onChanged={refreshed} />}
        {activeTab === 'ai' && <TenantAiTab data={data} />}
        {activeTab === 'channels' && <TenantChannelsTab data={data} />}
        {activeTab === 'activity' && (
          <Section title="Admin activity on this tenant" description="Changes made through this console. The most recent 20.">
            <div className="rounded-lg border border-gray-200 bg-white px-3"><AuditList rows={data.auditLog.map((r) => ({ ...r, resourceType: r.resourceType ?? null, resourceId: r.resourceId ?? null }))} /></div>
          </Section>
        )}
      </div>

      <ActionDialog
        open={dialog === 'suspend'} onClose={close} tone="danger" title={`Suspend ${data.name}?`} confirmLabel="Suspend tenant"
        description="Everyone in this workspace loses access straight away and cannot sign back in, and messages arriving through WhatsApp Cloud API, Messenger and Instagram stop being processed. No data is deleted, and you can reactivate it at any time."
        reason={{ label: 'Why is it being suspended?', required: true }}
        onConfirm={async (reason) => { await adminApi.suspendWorkspace(data.id, reason); toast.success(`${data.name} suspended`); refreshed(); }}
      />
      <ActionDialog
        open={dialog === 'activate'} onClose={close} title={`Reactivate ${data.name}?`} confirmLabel="Reactivate tenant"
        description="The workspace works again for everyone in it, and messages arriving through WhatsApp Cloud API, Messenger and Instagram are processed again."
        reason={{ label: 'Note', required: false }}
        onConfirm={async (reason) => { await adminApi.activateWorkspace(data.id, reason || undefined); toast.success(`${data.name} reactivated`); refreshed(); }}
      />
      <ActionDialog
        open={dialog === 'edit'} onClose={close} title="Edit tenant" confirmLabel="Save changes" submitDisabled={name.trim() === '' || !emailOk}
        description="Changes the name shown across the platform and the address invoices go to."
        onConfirm={async () => {
          const changes: { name?: string; billingEmail?: string } = {};
          if (name.trim() !== data.name) changes.name = name.trim();
          if (billingEmail.trim() !== (data.billingEmail ?? '') && billingEmail.trim() !== '') changes.billingEmail = billingEmail.trim();
          if (Object.keys(changes).length === 0) return;
          await adminApi.updateWorkspace(data.id, changes);
          toast.success('Tenant updated'); refreshed();
        }}
      >
        <div className="space-y-3">
          <div><label htmlFor="t-name" className="block text-sm font-medium text-gray-800 mb-1">Name</label><input id="t-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="t-email" className="block text-sm font-medium text-gray-800 mb-1">Billing email</label><input id="t-email" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} aria-invalid={!emailOk} className={inputCls} />{!emailOk && <p role="alert" className="text-xs text-red-700 mt-1">Enter a valid email address.</p>}</div>
        </div>
      </ActionDialog>
      <ActionDialog
        open={dialog === 'plan'} onClose={close} tone="danger" title="Assign a plan without payment" confirmLabel="Assign plan" submitDisabled={!planSlug}
        description={<>This sets <strong>{data.name}</strong> to the chosen plan as <strong>active for 10 years</strong> and takes no payment. Use it for accounts you are giving away or setting up by hand. It will count toward MRR at the plan&apos;s list price.</>}
        details={<>Current plan: <strong>{data.subscription ? `${data.subscription.plan.name} (${data.subscription.status.toLowerCase()})` : 'none'}</strong></>}
        reason={{ label: 'Why is this being assigned?', required: true }}
        onConfirm={async (reason) => { await adminApi.forceSubscription(data.id, planSlug, reason); toast.success(`${data.name} is now on ${chosenPlan?.name ?? planSlug}`); refreshed(); }}
      >
        <div>
          <label htmlFor="t-plan" className="block text-sm font-medium text-gray-800 mb-1">Plan</label>
          <select id="t-plan" value={planSlug} onChange={(e) => setPlanSlug(e.target.value)} className={inputCls}>
            <option value="">Choose a plan</option>
            {(plans.data ?? []).map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          {plans.error && <p role="alert" className="text-xs text-red-700 mt-1">Plans could not be loaded: {plans.error}</p>}
        </div>
      </ActionDialog>
      <ActionDialog
        open={dialog === 'credits'} onClose={close} title="Grant AI credits" confirmLabel="Grant credits" submitDisabled={!creditsOk}
        description="Adds credits to this tenant's balance straight away. Credits cannot be taken back through this screen."
        details={<>
          <div className="flex justify-between"><span className="text-gray-600">Balance now</span><span className="tabular-nums font-medium">{formatNumber(data.aiCredits)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Adding</span><span className="tabular-nums font-medium">{creditsOk ? `+${creditsN.toLocaleString()}` : 'n/a'}</span></div>
          <div className="flex justify-between border-t border-gray-200 mt-1.5 pt-1.5"><span className="text-gray-600">Balance after</span><span className="tabular-nums font-semibold">{creditsOk ? (data.aiCredits + creditsN).toLocaleString() : 'n/a'}</span></div>
        </>}
        reason={{ label: 'What is this for?', required: true }}
        onConfirm={async (description) => {
          const res = await adminApi.grantCredits(data.id, creditsN, description, creditType);
          if (!res.success) throw new Error('The grant was recorded but the balance did not change. Check the credit transactions before trying again.');
          toast.success(`${creditsN.toLocaleString()} credits granted`); refreshed();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="t-credits" className="block text-sm font-medium text-gray-800 mb-1">Credits</label><input id="t-credits" inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/[^\d]/g, ''))} aria-invalid={credits !== '' && !creditsOk} className={inputCls} />{credits !== '' && !creditsOk && <p role="alert" className="text-xs text-red-700 mt-1">A whole number from 1 to {MAX_CREDIT_GRANT.toLocaleString()}.</p>}</div>
          <div><label htmlFor="t-ctype" className="block text-sm font-medium text-gray-800 mb-1">Type</label><select id="t-ctype" value={creditType} onChange={(e) => setCreditType(e.target.value as 'BONUS' | 'ADJUSTMENT')} className={inputCls}><option value="BONUS">Bonus</option><option value="ADJUSTMENT">Adjustment</option></select></div>
        </div>
      </ActionDialog>
    </div>
  );
}
