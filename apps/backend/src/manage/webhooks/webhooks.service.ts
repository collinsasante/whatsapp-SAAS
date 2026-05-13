import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateWebhookDto {
  name: string;
  url: string;
  events?: string[];
  secret?: string;
}

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(tenantId: string, dto: CreateWebhookDto) {
    return this.prisma.webhook.create({
      data: {
        tenantId,
        name: dto.name,
        url: dto.url,
        events: dto.events ?? [],
        secret: dto.secret,
      },
    });
  }

  async update(id: string, tenantId: string, dto: Partial<CreateWebhookDto> & { isActive?: boolean }) {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');
    return this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.url && { url: dto.url }),
        ...(dto.events && { events: dto.events }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');
    return this.prisma.webhook.delete({ where: { id } });
  }

  async test(id: string, tenantId: string) {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');

    const payload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery from WhatsApp Platform' },
    };

    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(wh.secret && { 'X-Webhook-Secret': wh.secret }),
        },
        body: JSON.stringify(payload),
      });
      await this.prisma.webhook.update({
        where: { id },
        data: { lastTriggeredAt: new Date(), failureCount: res.ok ? 0 : wh.failureCount + 1 },
      });
      return { success: res.ok, status: res.status };
    } catch {
      await this.prisma.webhook.update({
        where: { id },
        data: { failureCount: wh.failureCount + 1 },
      });
      return { success: false, error: 'Connection failed' };
    }
  }
}
