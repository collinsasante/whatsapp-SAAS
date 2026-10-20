import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Webhook } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsEncryptionService } from '../../common/crypto/credentials-encryption.service';
import { AuditService } from '../../audit/audit.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { generateWebhookSecret, isAcceptableManualSecret } from './webhook-secret.util';
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from './webhook-url.util';
import { validateCustomHeaders } from './webhook-headers.util';

export type { CreateWebhookDto } from './dto/webhook.dto';

/** What the API returns for a webhook. Never contains the secret or header values (custom headers often hold tokens). */
export type PublicWebhook = Omit<Webhook, 'secret' | 'headers'> & { hasSecret: boolean; headerNames: string[] };

const TEST_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CredentialsEncryptionService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  toPublic(wh: Webhook): PublicWebhook {
    const { secret, headers, ...rest } = wh;
    return { ...rest, hasSecret: !!secret, headerNames: Object.keys((headers as Record<string, string> | null) ?? {}) };
  }

  async list(tenantId: string): Promise<PublicWebhook[]> {
    const rows = await this.prisma.webhook.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toPublic(r));
  }

  private get allowPrivateUrls(): boolean {
    return this.config.get<string>('WEBHOOK_ALLOW_PRIVATE_URLS') === 'true';
  }

  private async assertUrl(url: string): Promise<void> {
    try {
      await assertSafeWebhookUrl(url, { allowPrivate: this.allowPrivateUrls });
    } catch (err) {
      if (err instanceof UnsafeWebhookUrlError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private assertHeaders(headers: Record<string, string> | undefined): void {
    const problem = validateCustomHeaders(headers);
    if (problem) throw new BadRequestException(problem);
  }

  private assertManualSecret(secret: string): void {
    if (!isAcceptableManualSecret(secret)) {
      throw new BadRequestException('A secret must be 16 to 256 visible characters with no spaces. Or let us generate a strong one for you.');
    }
  }

  private async record(tenantId: string, userId: string | undefined, action: 'CREATE' | 'UPDATE' | 'DELETE', id: string, metadata: Record<string, unknown>): Promise<void> {
    // ids and field names only: never the secret, URL query strings or header values
    await this.audit.log({ tenantId, userId, action, resource: 'webhook', resourceId: id, metadata })
      .catch((err) => this.logger.warn(`audit log failed for webhook ${id}: ${err instanceof Error ? err.message : String(err)}`));
  }

  /** The secret is returned here, once, and only here (and from rotateSecret). It cannot be read back later. */
  async create(tenantId: string, dto: CreateWebhookDto, userId?: string): Promise<PublicWebhook & { secret?: string }> {
    await this.assertUrl(dto.url);
    this.assertHeaders(dto.headers);

    // Every new webhook is signed. A secret is generated unless an API client supplies its own (validated) one or
    // explicitly passes generateSecret=false. The dashboard never offers a manual secret.
    let plainSecret: string | undefined;
    if (dto.generateSecret === true || (dto.generateSecret === undefined && !dto.secret)) {
      plainSecret = generateWebhookSecret();
    } else if (dto.secret) {
      this.assertManualSecret(dto.secret);
      plainSecret = dto.secret;
    }

    const row = await this.prisma.webhook.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        url: dto.url.trim(),
        events: dto.events ?? [],
        secret: plainSecret ? this.crypto.encrypt(plainSecret) : undefined,
        headers: dto.headers ?? undefined,
      },
    });
    await this.record(tenantId, userId, 'CREATE', row.id, { name: row.name, secretGenerated: !!dto.generateSecret, hasSecret: !!plainSecret });
    return { ...this.toPublic(row), ...(plainSecret && { secret: plainSecret }) };
  }

  async update(id: string, tenantId: string, dto: UpdateWebhookDto, userId?: string): Promise<PublicWebhook> {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');
    if (dto.url !== undefined) await this.assertUrl(dto.url);
    this.assertHeaders(dto.headers);
    if (dto.secret !== undefined) this.assertManualSecret(dto.secret);

    await this.prisma.webhook.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.url && { url: dto.url.trim() }),
        ...(dto.events && { events: dto.events }),
        ...(dto.secret !== undefined && { secret: this.crypto.encrypt(dto.secret) }),
        ...(dto.headers !== undefined && { headers: dto.headers }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    const updated = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!updated) throw new NotFoundException('Webhook not found');
    await this.record(tenantId, userId, 'UPDATE', id, {
      fields: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
      secretReplaced: dto.secret !== undefined,
    });
    return this.toPublic(updated);
  }

  /** Explicit, user-triggered rotation. Existing secrets are never rotated implicitly. */
  async rotateSecret(id: string, tenantId: string, userId?: string): Promise<PublicWebhook & { secret: string }> {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');
    const plainSecret = generateWebhookSecret();
    await this.prisma.webhook.updateMany({ where: { id, tenantId }, data: { secret: this.crypto.encrypt(plainSecret) } });
    await this.record(tenantId, userId, 'UPDATE', id, { secretRotated: true });
    return { ...this.toPublic({ ...wh, secret: 'set' }), secret: plainSecret };
  }

  async remove(id: string, tenantId: string, userId?: string) {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');
    await this.prisma.webhook.deleteMany({ where: { id, tenantId } });
    await this.record(tenantId, userId, 'DELETE', id, { name: wh.name });
    return { success: true };
  }

  async test(id: string, tenantId: string) {
    const wh = await this.prisma.webhook.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('Webhook not found');

    // Re-checked at send time, not only when saved: DNS can change after a URL was accepted.
    try {
      await assertSafeWebhookUrl(wh.url, { allowPrivate: this.allowPrivateUrls });
    } catch (err) {
      if (err instanceof UnsafeWebhookUrlError) return { success: false, error: err.message };
      throw err;
    }

    let secret = '';
    try {
      secret = this.crypto.decrypt(wh.secret);
    } catch {
      return { success: false, error: 'The stored secret could not be read. Regenerate it and try again.' };
    }

    const payload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery from WhatsApp Platform' },
    };
    const customHeaders = (wh.headers as Record<string, string> | null) ?? {};

    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Unchanged on purpose: existing consumers verify this exact header.
          ...(secret && { 'X-Webhook-Secret': secret }),
          ...customHeaders,
        },
        body: JSON.stringify(payload),
        redirect: 'manual', // a redirect could point at an internal address we just refused to call
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      const ok = res.ok;
      await this.prisma.webhook.updateMany({
        where: { id, tenantId },
        data: { lastTriggeredAt: new Date(), failureCount: ok ? 0 : wh.failureCount + 1 },
      });
      return { success: ok, status: res.status };
    } catch {
      await this.prisma.webhook.updateMany({ where: { id, tenantId }, data: { failureCount: wh.failureCount + 1 } });
      return { success: false, error: 'Connection failed' };
    }
  }
}
