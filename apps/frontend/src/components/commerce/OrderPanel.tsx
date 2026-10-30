'use client';
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { commerceOrdersApi } from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { useWidget } from '@/lib/dashboard/useWidget';
import { showConfirm } from '@/store/confirm.store';
import { Button } from '@/components/ui/Button';
import SidePanel from '@/components/ui/SidePanel';
import StatusBadge from '@/components/ui/StatusBadge';
import Skeleton from '@/components/ui/Skeleton';
import { formatDateTime, formatMoney, ORDER_STATUS, orderRef } from '@/lib/commerce/format';
import type { OrderDetail, OrderStatus } from '@/lib/commerce/types';

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Order started', ITEM_ADDED: 'Item added', SENT_FOR_APPROVAL: 'Sent for approval', APPROVED: 'Approved',
  SUBMITTED_FOR_PAYMENT: 'Payment link created', PAYMENT_INITIATED: 'Payment started', PAID: 'Payment received',
  FULFILLMENT_UPDATED: 'Status updated', CANCELLED: 'Cancelled', REFUNDED: 'Refunded',
};

/** Fulfilment steps the server accepts from each status (PAID itself only ever comes from a verified payment). */
const FULFILMENT_NEXT: Partial<Record<OrderStatus, Array<{ to: 'FULFILLING' | 'COMPLETED'; label: string }>>> = {
  PAID: [{ to: 'FULFILLING', label: 'Start fulfilling' }, { to: 'COMPLETED', label: 'Mark completed' }],
  FULFILLING: [{ to: 'COMPLETED', label: 'Mark completed' }],
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="text-sm text-gray-900 text-right break-words min-w-0">{children}</dd>
    </div>
  );
}

/** The whole order on one screen, with the actions the server allows for its current status. */
export default function OrderPanel({ orderId, canManage, onClose, onChanged }: {
  orderId: string | null;
  /** Approving, rejecting and checking payment are admin actions on the server too. */
  canManage: boolean;
  onClose: () => void;
  /** Called after any change so the list behind the panel is reloaded. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const detail = useWidget<OrderDetail | null>(`order:${orderId}`, async (signal) => {
    if (!orderId) return null;
    return (await commerceOrdersApi.get(orderId, signal)).data as OrderDetail;
  }, { enabled: orderId != null });
  const order = detail.data;

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      detail.reload();
      onChanged();
    } catch (e) {
      toast.error(getApiError(e, 'That did not work. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }, [detail, onChanged]);

  const act = {
    approve: () => run(async () => {
      if (!(await showConfirm('Approve this order?', { subtext: 'The customer is sent a payment link.', confirmLabel: 'Approve', danger: false }))) return;
      await commerceOrdersApi.approve(order!.id);
      toast.success('Approved. The customer was sent a payment link.');
    }),
    reject: () => run(async () => {
      if (!(await showConfirm('Reject this order?', { subtext: 'It is cancelled and the customer is not charged.', confirmLabel: 'Reject order' }))) return;
      await commerceOrdersApi.reject(order!.id);
      toast.success('The order was rejected.');
    }),
    cancel: () => run(async () => {
      if (!(await showConfirm('Cancel this order?', { subtext: 'A cancelled order cannot be reopened.', confirmLabel: 'Cancel order' }))) return;
      await commerceOrdersApi.cancel(order!.id);
      toast.success('The order was cancelled.');
    }),
    verify: () => run(async () => {
      const res = await commerceOrdersApi.verifyPayment(order!.id);
      const data = res.data as { verified: boolean; reason?: string };
      if (data.verified) toast.success('Paystack confirmed the payment. The order is paid.');
      else toast.error(data.reason ?? 'Paystack has not confirmed this payment yet.');
    }),
    fulfil: (to: 'FULFILLING' | 'COMPLETED', label: string) => run(async () => {
      if (!(await showConfirm(`${label}?`, { subtext: to === 'COMPLETED' ? 'The order is closed as completed.' : 'The order moves to fulfilling.', confirmLabel: label, danger: false }))) return;
      await commerceOrdersApi.updateFulfillment(order!.id, to);
      toast.success(to === 'COMPLETED' ? 'The order is completed.' : 'The order is being fulfilled.');
    }),
  };

  const status = order ? ORDER_STATUS[order.status] : null;
  const actions: React.ReactNode[] = [];
  if (order && canManage) {
    if (order.status === 'AWAITING_APPROVAL') {
      actions.push(<Button key="reject" variant="danger" onClick={act.reject} disabled={busy}>Reject</Button>, <Button key="approve" onClick={act.approve} disabled={busy}>Approve and send payment link</Button>);
    }
    if (order.status === 'PENDING_PAYMENT') {
      actions.push(<Button key="verify" variant="secondary" onClick={act.verify} disabled={busy}>Check payment with Paystack</Button>);
    }
    if (order.status === 'DRAFT' || order.status === 'PENDING_PAYMENT') {
      actions.push(<Button key="cancel" variant="danger" onClick={act.cancel} disabled={busy}>Cancel order</Button>);
    }
    for (const step of FULFILMENT_NEXT[order.status] ?? []) {
      actions.push(<Button key={step.to} variant={step.to === 'COMPLETED' ? 'primary' : 'secondary'} onClick={() => act.fulfil(step.to, step.label)} disabled={busy}>{step.label}</Button>);
    }
  }

  return (
    <SidePanel
      open={orderId != null} onClose={onClose} width="max-w-xl"
      title={order ? <span className="inline-flex flex-wrap items-center gap-2">Order {orderRef(order.id)}{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</span> : 'Order'}
      description={order ? `Placed ${formatDateTime(order.createdAt)}` : undefined}
      footer={actions.length ? <>{busy && <Loader2 size={14} className="animate-spin text-gray-500" aria-label="Working" />}{actions}</> : undefined}
    >
      {detail.loading && !order ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-32" /><Skeleton className="h-24" /></div>
      ) : detail.error && !order ? (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4 space-y-2">
          <p className="text-sm font-medium text-gray-900">This order could not be loaded</p>
          <p className="text-sm text-gray-600">{detail.error}</p>
          <Button size="sm" onClick={detail.reload}>Try again</Button>
        </div>
      ) : order ? (
        <div className="space-y-6">
          <section aria-labelledby="order-customer">
            <h3 id="order-customer" className="text-sm font-semibold text-gray-900">Customer</h3>
            <dl className="mt-1 divide-y divide-gray-100">
              <Row label="Name">{order.customerName ?? <span className="text-gray-500">Not given</span>}</Row>
              <Row label="Phone">{order.customerPhone}</Row>
            </dl>
          </section>

          <section aria-labelledby="order-items">
            <h3 id="order-items" className="text-sm font-semibold text-gray-900">Items</h3>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th scope="col" className="py-1 font-medium">Item</th><th scope="col" className="py-1 text-right font-medium">Qty</th><th scope="col" className="py-1 text-right font-medium">Price</th><th scope="col" className="py-1 text-right font-medium">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-2 text-gray-900">{i.productNameSnapshot}{i.variantLabelSnapshot && <span className="block text-xs text-gray-500">{i.variantLabelSnapshot}</span>}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{formatMoney(i.unitPriceMajorUnitsSnapshot, order.currency)}</td>
                    <td className="py-2 text-right tabular-nums text-gray-900">{formatMoney(i.lineTotalMajorUnits, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200"><th scope="row" colSpan={3} className="pt-2 text-right text-sm font-medium text-gray-900">Total</th><td className="pt-2 text-right text-sm font-semibold tabular-nums text-gray-900">{formatMoney(order.totalMajorUnits, order.currency)}</td></tr>
              </tfoot>
            </table>
          </section>

          <section aria-labelledby="order-payment">
            <h3 id="order-payment" className="text-sm font-semibold text-gray-900">Payment</h3>
            <dl className="mt-1 divide-y divide-gray-100">
              <Row label="Paid">{order.paidAt ? formatDateTime(order.paidAt) : <span className="text-gray-500">Not yet</span>}</Row>
              <Row label="Through">{order.paymentGateway ?? <span className="text-gray-500">Not started</span>}</Row>
              {order.paystackReference && <Row label="Reference"><span className="font-mono text-xs">{order.paystackReference}</span></Row>}
              {order.cancelledAt && <Row label="Cancelled">{formatDateTime(order.cancelledAt)}{order.cancelReason ? `, ${order.cancelReason}` : ''}</Row>}
            </dl>
          </section>

          <section aria-labelledby="order-history">
            <h3 id="order-history" className="text-sm font-semibold text-gray-900">History</h3>
            {order.events.length === 0 ? <p className="mt-1 text-sm text-gray-500">Nothing has happened to this order yet.</p> : (
              <ol className="mt-2 space-y-2 border-l border-gray-200 pl-4">
                {order.events.map((ev) => (
                  <li key={ev.id} className="text-sm">
                    <span className="text-gray-900">{EVENT_LABEL[ev.type] ?? ev.type}</span>
                    <span className="block text-xs text-gray-500">{formatDateTime(ev.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </SidePanel>
  );
}
