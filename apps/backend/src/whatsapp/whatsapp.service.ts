import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as FormData from 'form-data';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateComponent } from '@whatsapp-platform/shared-types';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';

const execAsync = promisify(exec);

// Detect WebM by EBML magic bytes (0x1A 0x45 0xDF 0xA3)
function isWebmBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

async function transcodeWebmToOgg(buffer: Buffer): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join('/tmp', `wa_in_${id}.webm`);
  const outputPath = path.join('/tmp', `wa_out_${id}.ogg`);
  try {
    fs.writeFileSync(inputPath, buffer);
    // Remux Opus from WebM container into OGG container — no re-encoding, instant
    await execAsync(`ffmpeg -y -i "${inputPath}" -c:a copy "${outputPath}"`);
    return fs.readFileSync(outputPath);
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

async function transcodeVideoToMp4(buffer: Buffer, inputMime: string): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString('hex');
  // Derive a safe extension from mime type (e.g. video/quicktime → mov)
  const extMap: Record<string, string> = {
    'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
    'video/webm': 'webm', 'video/x-matroska': 'mkv',
    'video/x-ms-wmv': 'wmv', 'video/mpeg': 'mpeg',
  };
  const ext = extMap[inputMime] ?? inputMime.split('/')[1]?.split(';')[0] ?? 'bin';
  const inputPath = path.join('/tmp', `vd_in_${id}.${ext}`);
  const outputPath = path.join('/tmp', `vd_out_${id}.mp4`);
  try {
    fs.writeFileSync(inputPath, buffer);
    // H.264 + AAC, veryfast preset, faststart for streaming
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { timeout: 180_000 },
    );
    return fs.readFileSync(outputPath);
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

function needsVideoTranscode(mimeType: string): boolean {
  const supported = ['video/mp4', 'video/3gpp', 'video/3gpp2'];
  return mimeType.startsWith('video/') && !supported.some((m) => mimeType.startsWith(m));
}

function metaError(error: unknown): string {
  if (error instanceof AxiosError && error.response) {
    const data = error.response.data as { error?: { message?: string; error_user_msg?: string } };
    return data?.error?.error_user_msg ?? data?.error?.message ?? JSON.stringify(data);
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

  async sendTextMessage(tenantId: string, to: string, text: string, contextMessageId?: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      };
      if (contextMessageId) payload['context'] = { message_id: contextMessageId };

      const response = await client.post(`/${phoneNumberId}/messages`, payload);
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
    contextMessageId?: string,
  ): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    const mediaTypeKey = mediaType.toLowerCase();
    const mediaPayload: Record<string, unknown> = { link: mediaUrl };
    if (caption && mediaTypeKey !== 'audio') mediaPayload['caption'] = caption;

    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaTypeKey,
        [mediaTypeKey]: mediaPayload,
      };
      if (contextMessageId) payload['context'] = { message_id: contextMessageId };

      const response = await client.post(`/${phoneNumberId}/messages`, payload);
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

  async sendLocationMessage(
    tenantId: string,
    to: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
  ): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'location',
        location: { latitude, longitude, name: name ?? '', address: address ?? '' },
      });
      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send location: ${msg}`);
      throw new BadRequestException(`Failed to send location: ${msg}`);
    }
  }

  async sendContactMessage(tenantId: string, to: string, name: string, phone: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'contacts',
        contacts: [{
          name: { formatted_name: name, first_name: name },
          phones: [{ phone, type: 'MOBILE' }],
        }],
      });
      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send contact: ${msg}`);
      throw new BadRequestException(`Failed to send contact: ${msg}`);
    }
  }

  async downloadMetaMedia(tenantId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string; filename?: string } | null> {
    try {
      const { accessToken } = await this.getTenantCredentials(tenantId);
      const client = this.getClient(accessToken!);
      const infoRes = await client.get<{ url: string; mime_type: string; id: string }>(`/${mediaId}`);
      const { url, mime_type } = infoRes.data;
      const dlRes = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 60000,
      });
      return { buffer: Buffer.from(dlRes.data), mimeType: mime_type };
    } catch (error: unknown) {
      this.logger.warn(`Failed to download Meta media ${mediaId}: ${metaError(error)}`);
      return null;
    }
  }

  async uploadMediaToMeta(tenantId: string, buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);

    let effectiveBuffer = buffer;
    let effectiveMime = mimeType;
    let effectiveFilename = filename;

    // Transcode WebM audio to OGG (Meta doesn't accept audio/webm)
    if (isWebmBuffer(buffer) || mimeType.startsWith('audio/webm')) {
      try {
        effectiveBuffer = await transcodeWebmToOgg(buffer);
        effectiveMime = 'audio/ogg';
        effectiveFilename = filename.replace(/\.(webm|ogg).*$/i, '') + '.ogg';
        this.logger.log('Transcoded WebM→OGG for Meta upload');
      } catch (transcodeErr) {
        this.logger.warn(`ffmpeg audio transcode failed, uploading as-is: ${transcodeErr}`);
      }
    }

    // Transcode non-MP4 video to MP4 (Meta only accepts video/mp4, video/3gpp)
    if (needsVideoTranscode(effectiveMime)) {
      try {
        this.logger.log(`Transcoding ${effectiveMime} → mp4 for Meta upload`);
        effectiveBuffer = await transcodeVideoToMp4(effectiveBuffer, effectiveMime);
        effectiveMime = 'video/mp4';
        effectiveFilename = filename.replace(/\.[^.]+$/, '') + '.mp4';
        this.logger.log('Video transcoding complete');
      } catch (transcodeErr) {
        this.logger.warn(`ffmpeg video transcode failed, uploading as-is: ${transcodeErr}`);
      }
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', effectiveBuffer, { filename: effectiveFilename, contentType: effectiveMime });

    const response = await axios.post<{ id: string }>(
      `${this.graphBaseUrl}/${phoneNumberId}/media`,
      form,
      {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
        timeout: 60000,
      },
    );
    return response.data.id;
  }

  async sendMediaMessageById(
    tenantId: string,
    to: string,
    mediaType: string,
    mediaId: string,
    caption?: string,
    contextMessageId?: string,
  ): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    const mediaTypeKey = mediaType.toLowerCase();
    const mediaPayload: Record<string, unknown> = { id: mediaId };
    if (caption && mediaTypeKey !== 'audio') mediaPayload['caption'] = caption;

    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: mediaTypeKey,
        [mediaTypeKey]: mediaPayload,
      };
      if (contextMessageId) payload['context'] = { message_id: contextMessageId };

      const response = await client.post(`/${phoneNumberId}/messages`, payload);
      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send media by id: ${msg}`);
      throw new BadRequestException(`Failed to send media: ${msg}`);
    }
  }

  async sendReaction(tenantId: string, to: string, waMessageId: string, emoji: string): Promise<void> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    try {
      await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'reaction',
        reaction: { message_id: waMessageId, emoji },
      });
    } catch (error: unknown) {
      this.logger.warn(`Failed to send reaction: ${metaError(error)}`);
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

  async initiateWhatsAppCall(tenantId: string, to: string, _type: 'audio' | 'video' = 'audio', sdpOffer?: string): Promise<{ callId: string }> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    const recipientId = to.replace(/^\+/, '');
    try {
      // action: "connect" is the correct field for outbound calls (not "type")
      const body: Record<string, unknown> = { messaging_product: 'whatsapp', to: recipientId, action: 'connect' };
      if (sdpOffer) body['session'] = { sdp_type: 'offer', sdp: sdpOffer };
      const response = await client.post<{ calls?: Array<{ id: string }>; call_id?: string; id?: string }>(`/${phoneNumberId}/calls`, body);
      // Meta can return { id }, { calls: [{ id }] }, or { call_id }
      const callId = response.data.id ?? response.data.calls?.[0]?.id ?? response.data.call_id ?? '';
      this.logger.log(`[calls] initiateWhatsAppCall response: ${JSON.stringify(response.data)} → callId=${callId}`);
      return { callId };
    } catch (err: any) {
      const metaError = err?.response?.data;
      this.logger.error('Meta calls API error', JSON.stringify(metaError ?? err?.message));
      throw new Error(metaError?.error?.message ?? err?.message ?? 'Meta call failed');
    }
  }

  async checkCallPermission(tenantId: string, userPhone: string): Promise<{
    status: 'granted' | 'pending' | 'denied' | 'expired' | 'no_permission';
    expirationTime?: number;
    canCall: boolean;
    canRequest: boolean;
  }> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    const userWaId = userPhone.replace(/^\+/, '');
    try {
      const response = await client.get(`/${phoneNumberId}/call_permissions`, {
        params: { user_wa_id: userWaId },
      });
      const data = response.data as {
        permission?: { status: string; expiration_time?: number };
        actions?: Array<{ action_name: string; can_perform_action: boolean }>;
      };
      const permStatus = (data.permission?.status ?? 'no_permission') as
        'granted' | 'pending' | 'denied' | 'expired' | 'no_permission';
      const canCall = data.actions?.find(a => a.action_name === 'start_call')?.can_perform_action
        ?? permStatus === 'granted';
      const canRequest = data.actions?.find(a => a.action_name === 'send_call_permission_request')?.can_perform_action
        ?? permStatus !== 'granted';
      return { status: permStatus, expirationTime: data.permission?.expiration_time, canCall, canRequest };
    } catch (err: any) {
      this.logger.warn(`Could not check call permission for ${userWaId}: ${metaError(err)}`);
      return { status: 'no_permission', canCall: false, canRequest: true };
    }
  }

  async requestCallPermission(tenantId: string, toPhone: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    const recipientId = toPhone.replace(/^\+/, '');
    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          body: { text: 'We would like to call you on WhatsApp to provide better support. Please tap Allow if you agree.' },
          action: { name: 'call_permission_request' },
        },
      });
      return (response.data as { messages: Array<{ id: string }> }).messages[0].id;
    } catch (err: unknown) {
      const msg = metaError(err);
      this.logger.error(`Failed to send call permission request to ${recipientId}: ${msg}`);
      throw new BadRequestException(`Failed to send call permission request: ${msg}`);
    }
  }

  async respondToWhatsAppCall(
    tenantId: string,
    whatsappCallId: string,
    action: 'pre_accept' | 'accept' | 'reject' | 'terminate',
    sdpAnswer?: string,
  ): Promise<void> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);
    try {
      const body: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        call_id: whatsappCallId,
        action,
      };
      if (sdpAnswer) {
        body['session'] = { sdp_type: 'answer', sdp: sdpAnswer };
      }
      this.logger.log(`[calls] respondToWhatsAppCall action=${action} hasSession=${!!sdpAnswer} sdpLen=${sdpAnswer?.length ?? 0}`);
      await client.post(`/${phoneNumberId}/calls`, body);
    } catch (err: unknown) {
      const metaError = (err as { response?: { data?: unknown } })?.response?.data;
      this.logger.error('Meta calls respond error', JSON.stringify(metaError ?? (err as Error)?.message));
      throw new Error(
        ((metaError as { error?: { message?: string } })?.error?.message) ??
        (err as Error)?.message ??
        'Meta call respond failed',
      );
    }
  }

  async submitTemplate(tenantId: string, templateData: {
    name: string;
    language: string;
    category: string;
    components: unknown[];
  }): Promise<{ id: string; status: string; category?: string }> {
    const tenant = await this.getTenantCredentials(tenantId);

    if (!tenant.wabaId) {
      throw new BadRequestException(
        'Template submission failed: No WABA ID configured. Go to Settings → Channels and enter your WhatsApp Business Account ID.',
      );
    }

    const tokenPreview = tenant.accessToken
      ? `${tenant.accessToken.slice(0, 8)}...${tenant.accessToken.slice(-4)}`
      : 'MISSING';
    this.logger.log(
      `Submitting template "${templateData.name}" to WABA ${tenant.wabaId} (token: ${tokenPreview})`,
    );

    const client = this.getClient(tenant.accessToken!);
    try {
      const response = await client.post<{ id: string; status: string; category?: string }>(
        `/${tenant.wabaId}/message_templates`,
        {
          name: templateData.name,
          language: templateData.language,
          category: templateData.category,
          components: templateData.components,
        },
      );
      return response.data;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(
        `Template submission failed — wabaId=${tenant.wabaId} token=${tokenPreview} error="${msg}"`,
      );
      throw new BadRequestException(
        `Template submission failed: ${msg}\n\nDebug info: wabaId=${tenant.wabaId} | token=${tokenPreview}\n\nFix: verify your WABA ID and access token in Settings → Channels.`,
      );
    }
  }

  async deleteTemplate(tenantId: string, templateName: string): Promise<void> {
    const tenant = await this.getTenantCredentials(tenantId);
    const client = this.getClient(tenant.accessToken!);
    try {
      await client.delete(`/${tenant.wabaId}/message_templates`, {
        params: { name: templateName },
      });
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.warn(`Failed to delete template from Meta: ${msg}`);
    }
  }

  async sendCsatSurvey(tenantId: string, to: string): Promise<string> {
    const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
    const client = this.getClient(accessToken!);

    try {
      const response = await client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Rate your experience' },
          body: { text: 'How would you rate the support you received today? Tap below to select your rating.' },
          footer: { text: 'Your feedback helps us improve' },
          action: {
            button: 'Select rating',
            sections: [
              {
                title: 'Your rating',
                rows: [
                  { id: 'csat_1', title: '★☆☆☆☆  1 / 5' },
                  { id: 'csat_2', title: '★★☆☆☆  2 / 5' },
                  { id: 'csat_3', title: '★★★☆☆  3 / 5' },
                  { id: 'csat_4', title: '★★★★☆  4 / 5' },
                  { id: 'csat_5', title: '★★★★★  5 / 5' },
                ],
              },
            ],
          },
        },
      });
      return response.data.messages[0].id as string;
    } catch (error: unknown) {
      const msg = metaError(error);
      this.logger.error(`Failed to send CSAT survey to ${to}: ${msg}`);
      throw new BadRequestException(`Failed to send CSAT: ${msg}`);
    }
  }

  async getBusinessProfile(tenantId: string) {
    try {
      const { phoneNumberId, accessToken } = await this.getTenantCredentials(tenantId);
      const client = this.getClient(accessToken!);
      const [phoneRes, profileRes] = await Promise.allSettled([
        client.get(`/${phoneNumberId}`, {
          params: { fields: 'verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status' },
        }),
        client.get(`/${phoneNumberId}/whatsapp_business_profile`, {
          params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
        }),
      ]);
      const phone = phoneRes.status === 'fulfilled' ? phoneRes.value.data : {};
      const profile = profileRes.status === 'fulfilled' ? (profileRes.value.data as { data?: unknown[] }).data?.[0] ?? {} : {};
      return { phone, profile };
    } catch {
      return null;
    }
  }
}
