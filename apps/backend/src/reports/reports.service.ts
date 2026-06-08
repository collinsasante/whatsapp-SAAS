import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsv).join(',');
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async exportContacts(tenantId: string, label?: string): Promise<string> {
    const where = {
      tenantId,
      ...(label ? { labels: { has: label } } : {}),
    };

    const contacts = await this.prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, phone: true, email: true,
        labels: true, isBlocked: true, optedOut: true,
        customFields: true, createdAt: true,
        conversations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, createdAt: true },
        },
      },
    });

    const headers = ['ID', 'Name', 'Phone', 'Email', 'Labels', 'Blocked', 'Opted Out', 'Last Conversation Status', 'Custom Fields', 'Created At'];
    const rows = contacts.map((c) => toCsvRow([
      c.id,
      c.name ?? '',
      c.phone,
      c.email ?? '',
      c.labels.join('; '),
      c.isBlocked ? 'Yes' : 'No',
      c.optedOut ? 'Yes' : 'No',
      c.conversations[0]?.status ?? '',
      c.customFields ? JSON.stringify(c.customFields) : '',
      c.createdAt.toISOString(),
    ]));

    return [toCsvRow(headers), ...rows].join('\n');
  }

  async exportCampaigns(tenantId: string): Promise<string> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { name: true, language: true, category: true } } },
    });

    const headers = [
      'ID', 'Name', 'Status', 'Template', 'Language', 'Category',
      'Total Recipients', 'Sent', 'Delivered', 'Read', 'Failed', 'Clicks',
      'Scheduled At', 'Started At', 'Completed At', 'Created At',
    ];

    const rows = campaigns.map((c) => toCsvRow([
      c.id, c.name, c.status,
      c.template.name, c.template.language, c.template.category ?? '',
      c.totalRecipients, c.sentCount, c.deliveredCount, c.readCount, c.failedCount,
      (c as unknown as { clickCount?: number }).clickCount ?? 0,
      c.scheduledAt?.toISOString() ?? '',
      c.startedAt?.toISOString() ?? '',
      c.completedAt?.toISOString() ?? '',
      c.createdAt.toISOString(),
    ]));

    return [toCsvRow(headers), ...rows].join('\n');
  }

  async exportConversations(tenantId: string, from: Date, to: Date): Promise<string> {
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        id: true, status: true, labels: true, contactSource: true,
        createdAt: true, resolvedAt: true, slaDeadline: true, slaBreached: true,
        csatScore: true,
        contact: { select: { name: true, phone: true, email: true } },
        assignedTo: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    });

    const headers = [
      'ID', 'Status', 'Contact Name', 'Contact Phone', 'Contact Email',
      'Assigned To', 'Labels', 'Source',
      'Messages', 'CSAT Score', 'SLA Breached',
      'Created At', 'Resolved At',
    ];

    const rows = conversations.map((c) => toCsvRow([
      c.id, c.status,
      c.contact.name ?? '', c.contact.phone, c.contact.email ?? '',
      c.assignedTo?.name ?? '',
      c.labels.join('; '), c.contactSource,
      c._count.messages, c.csatScore ?? '', c.slaBreached ? 'Yes' : 'No',
      c.createdAt.toISOString(), c.resolvedAt?.toISOString() ?? '',
    ]));

    return [toCsvRow(headers), ...rows].join('\n');
  }
}
