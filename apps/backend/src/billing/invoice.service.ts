import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus, PaymentGateway } from '@whatsapp-platform/shared-types';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async generateNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({
      where: { tenantId, createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const seq = String(count + 1).padStart(4, '0');
    const tenantPrefix = (await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    }))?.name?.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) ?? tenantId.slice(0, 6).toUpperCase();
    return `INV-${tenantPrefix}-${year}-${seq}`;
  }

  async createInvoice(opts: {
    tenantId: string;
    planName: string;
    planSlug: string;
    amount: number;
    tax?: number;
    discount?: number;
    currency?: string;
    gateway?: PaymentGateway;
    billingEmail?: string;
    billingName?: string;
    periodStart: Date;
    periodEnd: Date;
    dueDate?: Date;
  }) {
    const invoiceNumber = await this.generateNumber(opts.tenantId);
    const subtotal = opts.amount;
    const tax = opts.tax ?? 0;
    const discount = opts.discount ?? 0;
    const total = subtotal + tax - discount;
    const dueDate = opts.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.invoice.create({
      data: {
        tenantId: opts.tenantId,
        invoiceNumber,
        status: InvoiceStatus.OPEN,
        subtotal,
        tax,
        discount,
        total,
        currency: opts.currency ?? 'USD',
        billingPeriodStart: opts.periodStart,
        billingPeriodEnd: opts.periodEnd,
        dueDate,
        billingEmail: opts.billingEmail,
        billingName: opts.billingName,
        gateway: opts.gateway,
        items: {
          create: [
            {
              description: `${opts.planName} Plan Subscription`,
              quantity: 1,
              unitPrice: subtotal,
              amount: subtotal,
            },
          ],
        },
      },
      include: { items: true },
    });
  }

  async markPaid(invoiceId: string, paidAt?: Date) {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.PAID, paidAt: paidAt ?? new Date() },
    });
  }

  async markVoid(invoiceId: string) {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID },
    });
  }

  async getInvoices(tenantId: string, limit = 24) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getInvoice(id: string, tenantId: string) {
    return this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: { items: true, payments: true },
    });
  }

  async setGatewayPaymentUrl(invoiceId: string, url: string, gatewayInvoiceId?: string) {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { gatewayPaymentUrl: url, gatewayInvoiceId },
    });
  }
}
