import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { MessageDirection, MessageStatus, MessageType } from '@whatsapp-platform/shared-types';

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async handleInboundEmail(payload: Record<string, unknown>) {
    const raw = (payload['from'] as string) ?? '';
    const subject = (payload['subject'] as string) ?? '(no subject)';
    const text = (payload['text'] as string) ?? '';
    const html = (payload['html'] as string) ?? '';

    // Parse "Name <email>" or plain email
    const match = /^(?:(.*?)\s*<([^>]+)>|(.+))$/.exec(raw.trim());
    const senderEmail = (match?.[2] ?? match?.[3] ?? raw).trim().toLowerCase();
    const senderName = match?.[1]?.trim() || senderEmail;

    const forwardTo = this.config.get<string>('SUPPORT_FORWARD_EMAIL', 'mr.asantee@gmail.com');
    const bodyHtml = html || `<pre>${text}</pre>`;

    // 1 — Forward to Gmail
    await this.emailService.sendRaw({
      to: forwardTo,
      subject: `[support] ${subject}`,
      html: `
        <p><strong>From:</strong> ${raw}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr style="margin:16px 0" />
        ${bodyHtml}
      `,
    }).catch((err: unknown) => {
      this.logger.error('Failed to forward inbound email', (err as Error).message);
    });

    // 2 — Find the support tenant (platform owner)
    const tenantId = this.config.get<string>('SUPPORT_TENANT_ID');
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({ where: { id: tenantId } })
      : await this.prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });

    if (!tenant) {
      this.logger.warn('No tenant found for inbound email — skipping conversation creation');
      return;
    }

    // 3 — Find or create EMAIL channel
    const channel = await this.prisma.channel.upsert({
      where: { tenantId_type_name: { tenantId: tenant.id, type: 'EMAIL', name: 'support@verzchat.com' } },
      create: { tenantId: tenant.id, type: 'EMAIL', name: 'support@verzchat.com', isActive: true },
      update: {},
    });

    // 4 — Find or create contact by email (use synthetic phone key since phone is required+unique)
    const syntheticPhone = `email:${senderEmail}`;
    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: syntheticPhone } },
      create: { tenantId: tenant.id, phone: syntheticPhone, name: senderName, email: senderEmail },
      update: { email: senderEmail, ...(senderName !== senderEmail && { name: senderName }) },
    });

    // 5 — Find open conversation or create a new one
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact.id, status: { not: 'RESOLVED' } },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId: tenant.id,
          contactId: contact.id,
          channelId: channel.id,
          status: 'REQUESTED',
          requestedAt: new Date(),
          contactSource: 'email',
          lastMessageAt: new Date(),
        },
      });
    } else if (!conversation.channelId) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { channelId: channel.id },
      });
    }

    // 6 — Create message
    const content = subject !== '(no subject)'
      ? `**${subject}**\n\n${text || '(see HTML body)'}`
      : (text || '(HTML email)');

    await this.prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        contactId: contact.id,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.DELIVERED,
        content: content.slice(0, 4000),
        metadata: { emailFrom: raw, emailSubject: subject, emailHtml: html.slice(0, 2000) },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    });

    this.logger.log(`Inbound email from ${senderEmail} → conversation ${conversation.id}`);
  }
}
