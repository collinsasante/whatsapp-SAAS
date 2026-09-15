import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { ChannelType, Prisma } from '@prisma/client';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.channel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async create(tenantId: string, dto: CreateChannelDto) {
    // Merge top-level WhatsApp fields into credentials for storage
    const mergedCredentials: Record<string, unknown> = { ...(dto.credentials ?? {}) };
    if (dto.phoneNumberId) mergedCredentials.phoneNumberId = dto.phoneNumberId;
    if (dto.wabaId)        mergedCredentials.wabaId        = dto.wabaId;
    if (dto.accessToken)   mergedCredentials.accessToken   = dto.accessToken;

    const channel = await this.prisma.channel.create({
      data: {
        tenantId,
        type: dto.type as ChannelType,
        name: dto.name,
        credentials: mergedCredentials as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    // Keep tenant WhatsApp fields in sync so all features (templates, messaging) use the same creds
    if (dto.type === ChannelType.WHATSAPP) {
      await this.syncWhatsAppToTenant(tenantId, dto.phoneNumberId, dto.wabaId, dto.accessToken);
    }

    return channel;
  }

  async update(tenantId: string, id: string, dto: UpdateChannelDto) {
    const existing = await this.findOne(tenantId, id);

    // Merge top-level WhatsApp fields into credentials
    let credentialsUpdate: Prisma.InputJsonValue | undefined;
    if (dto.credentials || dto.phoneNumberId || dto.wabaId || dto.accessToken) {
      const base = (existing.credentials as Record<string, unknown>) ?? {};
      credentialsUpdate = {
        ...base,
        ...(dto.credentials ?? {}),
        ...(dto.phoneNumberId && { phoneNumberId: dto.phoneNumberId }),
        ...(dto.wabaId        && { wabaId:        dto.wabaId }),
        ...(dto.accessToken   && { accessToken:   dto.accessToken }),
      } as Prisma.InputJsonValue;
    }

    const channel = await this.prisma.channel.update({
      where: { id },
      data: {
        ...(dto.name       !== undefined && { name:      dto.name }),
        ...(dto.isActive   !== undefined && { isActive:  dto.isActive }),
        ...(credentialsUpdate            && { credentials: credentialsUpdate }),
        ...(dto.metadata                 && { metadata:  dto.metadata as Prisma.InputJsonValue }),
      },
    });

    // Sync WhatsApp fields to tenant whenever they're provided
    if (existing.type === ChannelType.WHATSAPP) {
      await this.syncWhatsAppToTenant(tenantId, dto.phoneNumberId, dto.wabaId, dto.accessToken);
    }

    return channel;
  }

  private async syncWhatsAppToTenant(
    tenantId: string,
    phoneNumberId?: string,
    wabaId?: string,
    accessToken?: string,
  ) {
    if (!phoneNumberId && !wabaId && !accessToken) return;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(phoneNumberId && { phoneNumberId }),
        ...(wabaId        && { wabaId }),
        ...(accessToken   && { accessToken }),
      },
    });

    // Keep whatsapp_numbers table in sync — upsert the entry for this phoneNumberId
    if (phoneNumberId && wabaId && accessToken) {
      const existing = await this.prisma.whatsAppNumber.findUnique({
        where: { tenantId_phoneNumberId: { tenantId, phoneNumberId } },
      });
      if (existing) {
        await this.prisma.whatsAppNumber.update({
          where: { id: existing.id },
          data: { wabaId, accessToken },
        });
      } else {
        // First number for this tenant → make it the default
        const hasDefault = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, isDefault: true } });
        await this.prisma.whatsAppNumber.create({
          data: {
            tenantId,
            label: 'Default',
            phoneNumberId,
            wabaId,
            accessToken,
            isDefault: !hasDefault,
          },
        });
      }
    }
  }

  async toggle(tenantId: string, id: string) {
    const channel = await this.findOne(tenantId, id);
    return this.prisma.channel.update({
      where: { id },
      data: { isActive: !channel.isActive },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.channel.delete({ where: { id } });
    return { success: true };
  }

  async connectOAuth(provider: string, tenantId: string, code: string, redirectUri: string) {
    if (provider === 'tiktok') {
      return this.connectTikTok(tenantId, code, redirectUri);
    }

    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');

    // Exchange auth code for user access token
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', appId!);
    tokenUrl.searchParams.set('client_secret', appSecret!);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number; error?: { message: string } };

    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${tokenData.error?.message ?? 'unknown error'}`);
    }

    const userToken = tokenData.access_token;
    // This is the short-lived USER token's expiry, not necessarily the page
    // token's own expiry (Facebook page tokens are commonly long-lived/
    // non-expiring) -- stored under a name that makes that distinction clear
    // rather than implying it's authoritative for the page token itself.
    const userTokenExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    if (provider === 'facebook') {
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}&fields=id,name,access_token`,
      );
      const pagesData = await pagesRes.json() as {
        data?: Array<{ id: string; name: string; access_token: string }>;
      };

      for (const page of pagesData.data ?? []) {
        await this.upsertOAuthChannel(tenantId, ChannelType.FACEBOOK_MESSENGER, page.name, {
          accessToken: page.access_token,
          pageId: page.id,
          ...(userTokenExpiresAt && { userTokenExpiresAt }),
        }, page.id);
      }

      if (!pagesData.data?.length) {
        throw new Error('No Facebook Pages found. Make sure your account manages at least one Page.');
      }
    } else if (provider === 'instagram') {
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}&fields=id,name,access_token,instagram_business_account`,
      );
      const pagesData = await pagesRes.json() as {
        data?: Array<{
          id: string;
          name: string;
          access_token: string;
          instagram_business_account?: { id: string };
        }>;
      };

      let connected = 0;
      for (const page of pagesData.data ?? []) {
        if (!page.instagram_business_account) continue;
        const igId = page.instagram_business_account.id;

        const igRes = await fetch(
          `https://graph.facebook.com/v19.0/${igId}?fields=name,username&access_token=${page.access_token}`,
        );
        const igData = await igRes.json() as { name?: string; username?: string };

        const channelName = igData.username ? `@${igData.username}` : (igData.name ?? page.name);
        await this.upsertOAuthChannel(tenantId, ChannelType.INSTAGRAM, channelName, {
          accessToken: page.access_token,
          pageId: page.id,
          igAccountId: igId,
          ...(userTokenExpiresAt && { userTokenExpiresAt }),
        }, igId);
        connected++;
      }

      if (connected === 0) {
        throw new Error('No Instagram Business accounts found. Make sure your Facebook Page is linked to an Instagram Business account.');
      }
    }
  }

  private async connectTikTok(tenantId: string, code: string, redirectUri: string) {
    const clientKey = this.config.get<string>('TIKTOK_CLIENT_ID');
    const clientSecret = this.config.get<string>('TIKTOK_CLIENT_SECRET');

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey!,
        client_secret: clientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData = await tokenRes.json() as {
      data?: { access_token: string; open_id: string; refresh_token: string; expires_in?: number };
      error?: { code: string; message: string };
    };

    if (tokenData.error?.code !== 'ok' || !tokenData.data?.access_token) {
      throw new Error(`TikTok token exchange failed: ${tokenData.error?.message ?? 'unknown'}`);
    }

    const { access_token, open_id, refresh_token, expires_in } = tokenData.data;
    const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : undefined;

    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    const userData = await userRes.json() as {
      data?: { user?: { display_name?: string } };
    };

    const displayName = userData.data?.user?.display_name ?? 'TikTok Account';

    await this.upsertOAuthChannel(tenantId, ChannelType.TIKTOK, displayName, {
      accessToken: access_token,
      openId: open_id,
      refreshToken: refresh_token,
      ...(tokenExpiresAt && { tokenExpiresAt }),
    }, open_id);
  }

  async connectTelegramBot(tenantId: string, botToken: string) {
    const verifyRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const verifyData = await verifyRes.json() as {
      ok: boolean;
      result?: { id?: number; username?: string; first_name?: string };
      description?: string;
    };

    if (!verifyData.ok) {
      throw new Error(verifyData.description ?? 'Invalid bot token');
    }

    const botName = verifyData.result?.username
      ? `@${verifyData.result.username}`
      : (verifyData.result?.first_name ?? 'Telegram Bot');

    // Telegram's own numeric bot ID (from getMe) is the stable identity for
    // this bot -- using it (not just tenantId+type) lets a tenant connect a
    // second, third bot without silently overwriting the first.
    const botId = String(verifyData.result?.id ?? botToken);

    return this.upsertOAuthChannel(tenantId, ChannelType.TELEGRAM, botName, { botToken }, botId);
  }

  // Keyed on tenantId + type + externalId (the provider's own stable account/
  // page/bot identifier, stored in credentials.externalId) rather than just
  // tenantId + type -- otherwise connecting a second Facebook Page, Instagram
  // account, or Telegram bot for the same tenant silently overwrites the
  // first instead of creating a second Channel row.
  private async upsertOAuthChannel(
    tenantId: string,
    type: ChannelType,
    name: string,
    credentials: Record<string, string>,
    externalId: string,
  ) {
    const existing = await this.prisma.channel.findFirst({
      where: { tenantId, type, credentials: { path: ['externalId'], equals: externalId } },
    });

    const credentialsWithId = { ...credentials, externalId };

    if (existing) {
      return this.prisma.channel.update({
        where: { id: existing.id },
        data: { name, credentials: credentialsWithId as Prisma.InputJsonValue, isActive: true },
      });
    }

    // [tenantId, type, name] is a real DB unique constraint -- two distinct
    // external accounts with the same display name (e.g. two Pages both
    // named "My Business") would otherwise throw on create. Disambiguate
    // deterministically rather than let the insert fail.
    let candidateName = name;
    let suffix = 1;
    while (await this.prisma.channel.findFirst({ where: { tenantId, type, name: candidateName } })) {
      suffix += 1;
      candidateName = `${name} ${suffix}`;
    }

    return this.prisma.channel.create({
      data: {
        tenantId,
        type,
        name: candidateName,
        credentials: credentialsWithId as Prisma.InputJsonValue,
        metadata: {} as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }
}
