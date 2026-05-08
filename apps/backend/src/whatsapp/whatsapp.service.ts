import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateComponent } from '@whatsapp-platform/shared-types';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';

function metaError(error: unknown): string {
  if (error instanceof AxiosError && error.response) {
    return JSON.stringify(error.response.data);
  }
  return error instanceof Error ? error.message : String(error);
}

export interface WhatsAppTextMessage {
  messaging_product: string;
  recipient_type: string;
  to: string;
  type: string;
  text: { body: string; preview_url?: boolean };
}

export interface WhatsAppTemplateMessage {
  messaging_product: string;
  to: string;
  type: string;
  template: {
    name: string;
    language: { code: string };
    components: unknown[];
  };
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly graphBaseUrl = 'https://graph.facebook.com/v23.0';

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private getClient(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: this.graphBaseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  private async getTenantCredentials(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { phoneNumberId: true, accessToken: true, wabaId: true },
    });

    if (!tenant?.phoneNumberId || !tenant?.accessToken) {
      throw new BadRequestException('WhatsApp Business API not configured for this workspace');
    }

    return tenant;
  }

  async sendTextMessage(tenantId: string, to: string, text: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      });

      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send text message to ${to}: ${msg}`);
      throw new BadRequestException(`Failed to send message: ${msg}`);
    }
  }

  async sendMediaMessage(
    tenantId: string,
    to: string,
    mediaType: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    const mediaTypeKey = mediaType.toLowerCase();
    const mediaPayload: Record<string, unknown> = { link: mediaUrl };
    // audio only supports `link`; image/video support `caption`; document supports `caption` and `filename`
    if (caption && mediaTypeKey !== 'audio') mediaPayload['caption'] = caption;

    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaTypeKey,
        [mediaTypeKey]: mediaPayload,
      });

      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send media message: ${msg}`);
      throw new BadRequestException(`Failed to send media: ${msg}`);
    }
  }

  async sendTemplateMessage(
    tenantId: string,
    to: string,
    templateName: string,
    language: string,
    components: TemplateComponent[],
    variables: Record<string, string>,
  ): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    const builtComponents = buildTemplateComponents(components, variables);

    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language },
          components: builtComponents,
        },
      });

      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send template: ${msg}`);
      throw new BadRequestException(`Failed to send template: ${msg}`);
    }
  }

  async syncTemplates(tenantId: string): Promise<void> {
    const tenant = await this.getTenantCredentials(tenantId);
    const client = this.getClient(tenant.accessToken!);

    try {
      const response = await client.get(`/${tenant.wabaId}/message_templates`, {
        params: { limit: 100 },
      });

      const templates = response.data.data as Array<{
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        components: TemplateComponent[];
      }>;

      for (const tpl of templates) {
        await this.prisma.template.upsert({
          where: { tenantId_name_language: { tenantId, name: tpl.name, language: tpl.language } },
          create: {
            tenantId,
            name: tpl.name,
            language: tpl.language,
            category: tpl.category as never,
            status: tpl.status as never,
            components: tpl.components as never,
            waTemplateId: tpl.id,
          },
          update: {
            status: tpl.status as never,
            components: tpl.components as never,
          },
        });
      }
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to sync templates: ${msg}`);
      throw new BadRequestException(`Template sync failed: ${msg}`);
    }
  }

  async getMediaUrl(tenantId: string, mediaId: string): Promise<string | null> {
    try {
      const { accessToken } = await this.getTenantCredentials(tenantId);
      const client = this.getClient(accessToken!);
      const response = await client.get<{ url: string }>(`/${mediaId}`);
      return response.data.url;
    } catch (error: unknown) {
      this.logger.warn(`Failed to get media URL for ${mediaId}: ${metaError(error)}`);
      return null;
    }
  }

  async markMessageRead(tenantId: string, whatsappMessageId: string): Promise<void> {
    try {
      const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
      const client = this.getClient(accessToken!);
      await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: whatsappMessageId,
      });
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.warn(`Failed to mark message as read: ${msg}`);
    }
  }
}
