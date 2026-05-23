import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { normalizePhone } from '@whatsapp-platform/shared-utils';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';
import axios from 'axios';

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private apiKeysService: ApiKeysService,
  ) {}

  async sendTemplateMessage(
    rawApiKey: string,
    to: string,
    templateName: string,
    language: string,
    variables: Record<string, string> = {},
  ) {
    // Validate API key
    const keyRecord = await this.apiKeysService.validateKey(rawApiKey);
    if (!keyRecord) throw new UnauthorizedException('Invalid or expired API key');

    const { tenantId } = keyRecord;

    // Get tenant credentials
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { phoneNumberId: true, accessToken: true },
    });
    if (!tenant?.phoneNumberId || !tenant?.accessToken) {
      throw new BadRequestException('WhatsApp is not configured for this workspace');
    }

    // Find the template
    const template = await this.prisma.template.findFirst({
      where: { tenantId, name: templateName, language, status: 'APPROVED' },
    });
    if (!template) {
      throw new BadRequestException(`Template "${templateName}" (${language}) not found or not approved`);
    }

    // Normalize and resolve contact
    const normalizedPhone = normalizePhone(to);
    let contact = await this.prisma.contact.findFirst({
      where: { tenantId, phone: normalizedPhone },
    });
    if (!contact) {
      contact = await this.prisma.contact.create({
        data: { tenantId, phone: normalizedPhone, name: normalizedPhone },
      });
    }

    // Build template components and send
    const components = buildTemplateComponents(template.components as never, variables);

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
      throw new BadRequestException(`WhatsApp API error: ${msg}`);
    });

    const whatsappMessageId = (response.data as { messages: { id: string }[] }).messages[0].id;

    // Get or create conversation for audit trail
    const conv = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: { not: 'RESOLVED' } },
    });
    const conversationId = conv?.id ?? (await this.prisma.conversation.create({
      data: { tenantId, contactId: contact.id, status: 'OPEN' },
    })).id;

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
        templateId: template.id,
        templateVariables: Object.keys(variables).length ? variables : undefined,
        sentAt: new Date(),
      },
    });

    return { success: true, messageId: whatsappMessageId, to: normalizedPhone };
  }
}
