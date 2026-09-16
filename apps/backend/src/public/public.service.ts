import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizePhone, interpolateTemplate } from '@whatsapp-platform/shared-utils';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private apiKeysService: ApiKeysService,
    private whatsappService: WhatsAppService,
  ) {}

  private async logCall(tenantId: string, apiKeyId: string, endpoint: string, opts: { phone?: string; templateName?: string; status: string; errorMessage?: string; ip?: string }) {
    void this.prisma.publicApiLog.create({ data: { tenantId, apiKeyId, endpoint, ...opts } }).catch(() => {});
  }

  async sendTemplateMessage(
    rawApiKey: string,
    to: string,
    templateName: string,
    language: string,
    variables: Record<string, string> = {},
    urlVariables?: Record<string, string>,
    ip?: string,
  ) {
    console.log('[PublicAPI] sendTemplateMessage called', { to, templateName, language, variables, urlVariables });

    // Validate API key
    const keyRecord = await this.apiKeysService.validateKey(rawApiKey);
    if (!keyRecord) {
      console.error('[PublicAPI] Invalid or missing API key');
      throw new UnauthorizedException('Invalid or expired API key');
    }

    const { tenantId } = keyRecord;
    console.log('[PublicAPI] API key valid, tenantId:', tenantId);

    // Find the template — match by prefix so "en" matches "en_US", "en_GB", etc.
    const template = await this.prisma.template.findFirst({
      where: { tenantId, name: templateName, language: { startsWith: language }, status: 'APPROVED' },
    });
    if (!template) {
      console.error('[PublicAPI] Template not found:', { tenantId, templateName, language });
      throw new BadRequestException(`Template "${templateName}" (${language}) not found or not approved`);
    }
    console.log('[PublicAPI] Template found:', template.id);

    // Normalize and resolve contact
    const normalizedPhone = normalizePhone(to);
    console.log('[PublicAPI] Normalized phone:', normalizedPhone);
    let contact = await this.prisma.contact.findFirst({
      where: { tenantId, phone: normalizedPhone },
    });
    if (!contact) {
      console.log('[PublicAPI] Contact not found, creating new contact for:', normalizedPhone);
      contact = await this.prisma.contact.create({
        data: { tenantId, phone: normalizedPhone, name: normalizedPhone },
      });
    }
    console.log('[PublicAPI] Contact id:', contact.id);

    // Send via the shared WhatsAppService (no conversation/number context on the
    // public API today, so this always goes out from the tenant's default
    // number -- consolidating this call fixed a Graph API version drift, v20.0
    // here vs v23.0 in every other send path).
    console.log('[PublicAPI] Sending to WhatsApp API');
    let whatsappMessageId: string;
    try {
      whatsappMessageId = await this.whatsappService.sendTemplateMessage(
        tenantId,
        normalizedPhone,
        template.name,
        template.language,
        template.components as never,
        variables,
        undefined,
        urlVariables,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PublicAPI] WhatsApp send failed:', msg);
      this.logCall(tenantId, keyRecord.id, 'send-template', { phone: normalizedPhone, templateName, status: 'ERROR', errorMessage: msg, ip });
      throw err;
    }
    console.log('[PublicAPI] Message sent, whatsappMessageId:', whatsappMessageId);

    // Get or create conversation for audit trail
    const conv = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: { not: 'RESOLVED' } },
    });
    const conversationId = conv?.id ?? (await this.prisma.conversation.create({
      data: { tenantId, contactId: contact.id, status: 'OPEN' },
    })).id;

    // Resolve template body so the message shows actual content in chat
    const bodyComp = (template.components as Array<{ type: string; text?: string }>)
      .find((c) => c.type === 'BODY');
    const resolvedContent = bodyComp?.text
      ? interpolateTemplate(bodyComp.text, variables)
      : null;

    // Log the message
    await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        contactId: contact.id,
        whatsappMessageId,
        direction: 'OUTBOUND',
        type: 'TEMPLATE',
        status: 'SENT',
        content: resolvedContent,
        templateId: template.id,
        templateVariables: Object.keys(variables).length ? variables : undefined,
        sentAt: new Date(),
      },
    });

    this.logCall(tenantId, keyRecord.id, 'send-template', { phone: normalizedPhone, templateName, status: 'OK', ip });
    return { success: true, messageId: whatsappMessageId, to: normalizedPhone };
  }

  async recordClick(code: string, ip?: string, userAgent?: string): Promise<string | null> {
    const click = await this.prisma.campaignClick.findUnique({ where: { code } });
    if (!click) return null;

    // Only record the first click per code
    if (!click.clickedAt) {
      await Promise.all([
        this.prisma.campaignClick.update({
          where: { code },
          data: { clickedAt: new Date(), ip: ip ?? null, userAgent: userAgent ?? null },
        }),
        this.prisma.campaign.update({
          where: { id: click.campaignId },
          data: { clickCount: { increment: 1 } },
        }),
      ]);
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: click.campaignId },
      select: { trackingUrl: true },
    });
    return campaign?.trackingUrl ?? null;
  }
}

