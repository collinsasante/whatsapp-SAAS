import type { StatusTone } from '@/components/ui/StatusBadge';
import type { OrderStatus, Product } from './types';

/** Money with the currency's own decimals (pesewas and cents are never rounded away). */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The short reference the rest of the product already uses for an order (task titles use the same form). */
export function orderRef(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  AWAITING_APPROVAL: { label: 'Needs approval', tone: 'warning' },
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  FULFILLING: { label: 'Fulfilling', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'danger' },
};

/** Statuses an order is waiting on someone or something in. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['AWAITING_APPROVAL', 'PENDING_PAYMENT', 'PAID', 'FULFILLING'];

/** Orders whose money has been received and not given back. */
export const PAID_ORDER_STATUSES: OrderStatus[] = ['PAID', 'FULFILLING', 'COMPLETED'];

export const LOW_STOCK_AT = 5;

export type StockState = 'untracked' | 'out' | 'low' | 'ok';

export function stockState(product: Pick<Product, 'stockQuantity'>): StockState {
  const q = product.stockQuantity;
  if (q == null) return 'untracked';
  if (q <= 0) return 'out';
  return q <= LOW_STOCK_AT ? 'low' : 'ok';
}

export const STOCK_LABEL: Record<StockState, { label: string; tone: StatusTone }> = {
  untracked: { label: 'Not tracked', tone: 'neutral' },
  out: { label: 'Out of stock', tone: 'danger' },
  low: { label: 'Low stock', tone: 'warning' },
  ok: { label: 'In stock', tone: 'success' },
};

/** A change since the previous period. Null when there is nothing to compare with, so no invented percentage is shown. */
export function changeSince(current: number, previous: number): { direction: 'up' | 'down' | 'flat'; percent: number } | null {
  if (previous === 0) return null;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return { direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat', percent: Math.abs(rounded) };
}

export function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
