import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { normalizePhone, buildTemplateComponents, interpolateTemplate } from '@whatsapp-platform/shared-utils';
import axios from 'axios';

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private apiKeysService: ApiKeysService,
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

    // Get tenant credentials
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { phoneNumberId: true, accessToken: true },
    });
    if (!tenant?.phoneNumberId || !tenant?.accessToken) {
      console.error('[PublicAPI] WhatsApp not configured for tenant:', tenantId);
      throw new BadRequestException('WhatsApp is not configured for this workspace');
    }
    console.log('[PublicAPI] Tenant found, phoneNumberId:', tenant.phoneNumberId);

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

    // Build template components and send
    const components = buildTemplateComponents(template.components as never, variables, urlVariables);
    console.log('[PublicAPI] Sending to WhatsApp API, components:', JSON.stringify(components));

    const response = await axios.post(
      `${GRAPH_API_BASE}/${tenant.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: normalizedPhone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${tenant.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    ).catch((err) => {
      const msg = err?.response?.data?.error?.message ?? err.message;
      console.error('[PublicAPI] WhatsApp Graph API error:', err?.response?.data ?? err.message);
      this.logCall(tenantId, keyRecord.id, 'send-template', { phone: normalizedPhone, templateName, status: 'ERROR', errorMessage: msg, ip });
      throw new BadRequestException(`WhatsApp API error: ${msg}`);
    });

    const whatsappMessageId = (response.data as { messages: { id: string }[] }).messages[0].id;
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

