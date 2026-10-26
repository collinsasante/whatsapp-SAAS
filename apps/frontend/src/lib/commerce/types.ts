export type OrderStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'PENDING_PAYMENT' | 'PAID' | 'FULFILLING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  priceMajorUnits: number;
  currency: string;
  isActive: boolean;
  imageUrl: string | null;
  /** Null means stock is not tracked (unlimited). */
  stockQuantity: number | null;
  minOrderQuantity: number | null;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  unitPriceMajorUnitsSnapshot: number;
  quantity: number;
  lineTotalMajorUnits: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  currency: string;
  subtotalMajorUnits: number;
  totalMajorUnits: number;
  customerName: string | null;
  customerPhone: string;
  paymentGateway: string | null;
  paystackReference: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface OrderEvent { id: string; type: string; data: Record<string, unknown> | null; createdAt: string }

export interface LedgerEntry {
  id: string;
  type: 'GMV' | 'TAKE_RATE' | 'REFUND_ADJUSTMENT';
  amountMajorUnits: number;
  currency: string;
  createdAt: string;
  data: Record<string, unknown> | null;
}

export interface OrderDetail extends Order {
  events: OrderEvent[];
  ledgerEntries: LedgerEntry[];
}

export interface LedgerRow extends LedgerEntry {
  orderId: string;
  order: { id: string; status: OrderStatus; customerName: string | null };
}

export interface LedgerPage { entries: LedgerRow[]; total: number; page: number; limit: number }

export interface RevenueTotals {
  gross: number; refunded: number; feeCharged: number; feeReturned: number; platformFee: number; net: number; paidOrders: number; refunds: number;
}
export interface RevenuePoint extends RevenueTotals { date: string }
export interface CurrencyRevenue {
  currency: string;
  current: RevenueTotals;
  previous: RevenueTotals;
  series: RevenuePoint[];
  products: { top: Array<{ productName: string; quantity: number; sales: number }>; otherProducts: number };
}
export interface RevenueSummary {
  meta: { from: string; to: string; previousFrom: string; previousTo: string; days: number; timezone: string; generatedAt: string };
  currencies: CurrencyRevenue[];
}
