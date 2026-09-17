import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppNumbersService } from '../whatsapp-numbers/whatsapp-numbers.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { ChannelType, Prisma } from '@prisma/client';

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

interface FacebookCandidatePage {
  id: string;
  name: string;
  access_token: string;
}

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private whatsAppNumbers: WhatsAppNumbersService,
    private encryption: CredentialsEncryptionService,
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

  // WhatsApp channels are created/updated entirely through
  // WhatsAppNumbersService (single write path -- encrypts the token,
  // links/creates the Channel row, keeps Tenant's denormalized default in
  // sync, and audit-logs) rather than writing Channel.credentials directly
  // here. This method still returns a Channel-shaped object either way, so
  // existing callers of POST/PATCH /channels see no contract change.
  async create(tenantId: string, dto: CreateChannelDto, actorId?: string) {
    if (dto.type === ChannelType.WHATSAPP) {
      if (!dto.phoneNumberId || !dto.wabaId || !dto.accessToken) {
        throw new BadRequestException('WhatsApp channels require phoneNumberId, wabaId, and accessToken');
      }
      const num = await this.whatsAppNumbers.create(tenantId, {
        label: dto.name,
        phoneNumberId: dto.phoneNumberId,
        wabaId: dto.wabaId,
        accessToken: dto.accessToken,
      }, actorId);
      if (!num.channelId) throw new Error('WhatsApp number was created without a linked channel');
      return this.findOne(tenantId, num.channelId);
    }

    const mergedCredentials: Record<string, unknown> = { ...(dto.credentials ?? {}) };
    return this.prisma.channel.create({
      data: {
        tenantId,
        type: dto.type as ChannelType,
        name: dto.name,
        credentials: mergedCredentials as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateChannelDto, actorId?: string) {
    const existing = await this.findOne(tenantId, id);

    if (existing.type === ChannelType.WHATSAPP) {
      const num = await this.prisma.whatsAppNumber.findFirst({ where: { tenantId, channelId: id } });
      if (num) {
        await this.whatsAppNumbers.update(tenantId, num.id, {
          label: dto.name,
          phoneNumberId: dto.phoneNumberId,
          wabaId: dto.wabaId,
          accessToken: dto.accessToken,
          isActive: dto.isActive,
        }, actorId);
        return this.findOne(tenantId, id);
      }
      // No linked WhatsAppNumber (shouldn't happen after the Phase 1
      // backfill, but fall through to the generic path rather than error).
    }

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

    return this.prisma.channel.update({
      where: { id },
      data: {
        ...(dto.name       !== undefined && { name:      dto.name }),
        ...(dto.isActive   !== undefined && { isActive:  dto.isActive }),
        ...(credentialsUpdate            && { credentials: credentialsUpdate }),
        ...(dto.metadata                 && { metadata:  dto.metadata as Prisma.InputJsonValue }),
      },
    });
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
    // Prefer the real, indexed externalId column now that it exists; still
    // check the legacy JSON-path match too so a row upserted before this
    // column existed (externalId only inside credentials) is found and
    // backfilled rather than duplicated.
    const existing = await this.prisma.channel.findFirst({
      where: {
        tenantId, type,
        OR: [{ externalId }, { credentials: { path: ['externalId'], equals: externalId } }],
      },
    });

    const credentialsWithId = { ...credentials, externalId };

    if (existing) {
      return this.prisma.channel.update({
        where: { id: existing.id },
        data: { name, externalId, credentials: credentialsWithId as Prisma.InputJsonValue, isActive: true },
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
        externalId,
        credentials: credentialsWithId as Prisma.InputJsonValue,
        metadata: {} as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }

  // ─── Facebook Messenger: real Page-selection flow ─────────────────────────
  // Replaces the old behavior (connectOAuth's facebook branch auto-connected
  // every Page the authorizing user manages). The OAuth callback now stops
  // at fetching the candidate Page list and stashes it server-side in a
  // short-lived OAuthConnectSession; nothing is actually connected until the
  // user explicitly selects which Page(s) via selectFacebookPages below.

  private async exchangeFacebookCode(code: string, redirectUri: string): Promise<string> {
    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');

    const tokenUrl = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId!);
    tokenUrl.searchParams.set('client_secret', appSecret!);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${tokenData.error?.message ?? 'unknown error'}`);
    }
    return tokenData.access_token;
  }

  // Page tokens minted from a short-lived user token inherit that ~1-2hr
  // lease. Exchanging for a long-lived user token first (Meta's documented
  // flow) means the resulting Page tokens are the long-lived/non-expiring
  // kind instead.
  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
    const appId = this.config.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');

    const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId!);
    url.searchParams.set('client_secret', appSecret!);
    url.searchParams.set('fb_exchange_token', shortLivedToken);

    const res = await fetch(url.toString());
    const data = await res.json() as { access_token?: string; error?: { message: string } };
    if (!data.access_token) {
      throw new Error(`Long-lived token exchange failed: ${data.error?.message ?? 'unknown error'}`);
    }
    return data.access_token;
  }

  private async fetchFacebookPages(userToken: string): Promise<FacebookCandidatePage[]> {
    const res = await fetch(`${GRAPH_API_BASE}/me/accounts?access_token=${userToken}&fields=id,name,access_token`);
    const data = await res.json() as { data?: FacebookCandidatePage[]; error?: { message: string } };
    if (data.error) throw new Error(`Failed to list Facebook Pages: ${data.error.message}`);
    return data.data ?? [];
  }

  /**
   * Called from the OAuth callback for provider=facebook. Exchanges the
   * auth code, fetches the user's manageable Pages, and stashes everything
   * needed to actually connect a subset of them in a short-lived session --
   * the Facebook user token is encrypted at rest and never reaches the
   * frontend, only the returned sessionId does.
   */
  async startFacebookPageSelection(tenantId: string, userId: string, code: string, redirectUri: string): Promise<{ sessionId: string; pageCount: number }> {
    // Opportunistic cleanup -- no cron/scheduler exists in this backend, so
    // expired sessions are swept lazily on the next OAuth-init rather than
    // accumulating indefinitely.
    void this.prisma.oAuthConnectSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    const shortLivedToken = await this.exchangeFacebookCode(code, redirectUri);
    const longLivedToken = await this.exchangeForLongLivedToken(shortLivedToken);
    const pages = await this.fetchFacebookPages(longLivedToken);

    if (pages.length === 0) {
      throw new Error('No Facebook Pages found. Make sure your account manages at least one Page.');
    }

    const session = await this.prisma.oAuthConnectSession.create({
      data: {
        tenantId,
        createdByUserId: userId,
        provider: 'facebook',
        userAccessToken: this.encryption.encrypt(longLivedToken),
        candidatePages: pages.map((p) => ({ id: p.id, name: p.name })) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    return { sessionId: session.id, pageCount: pages.length };
  }

  /** Candidate Page list for a pending selection session -- never the token. */
  async getFacebookConnectSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.oAuthConnectSession.findFirst({
      where: { id: sessionId, tenantId, provider: 'facebook', expiresAt: { gt: new Date() } },
    });
    if (!session) throw new NotFoundException('This connection session has expired or does not exist. Please reconnect.');

    const candidatePages = session.candidatePages as unknown as Array<{ id: string; name: string }>;
    const existingChannels = await this.prisma.channel.findMany({
      where: { tenantId, type: ChannelType.FACEBOOK_MESSENGER, externalId: { in: candidatePages.map((p) => p.id) } },
      select: { externalId: true },
    });
    const alreadyConnectedIds = new Set(existingChannels.map((c) => c.externalId));

    return {
      candidatePages: candidatePages.map((p) => ({ ...p, alreadyConnected: alreadyConnectedIds.has(p.id) })),
    };
  }

  /**
   * Connects the selected Page(s): subscribes each Page's Messenger webhook
   * fields, then upserts the Channel + FacebookPageConnection rows. Fails
   * loudly per-page (not silently skipping) if the webhook subscription
   * call itself fails, since a Page without a real subscription would
   * appear connected while never actually receiving messages.
   */
  async selectFacebookPages(tenantId: string, userId: string, sessionId: string, pageIds: string[]) {
    const session = await this.prisma.oAuthConnectSession.findFirst({
      where: { id: sessionId, tenantId, provider: 'facebook', expiresAt: { gt: new Date() } },
    });
    if (!session) throw new NotFoundException('This connection session has expired or does not exist. Please reconnect.');

    const candidatePages = session.candidatePages as unknown as Array<{ id: string; name: string }>;
    const validIds = new Set(candidatePages.map((p) => p.id));
    if (!pageIds.every((id) => validIds.has(id))) {
      throw new BadRequestException('One or more selected Pages were not in the original candidate list.');
    }

    // Re-fetch page tokens fresh from the stored (decrypted) long-lived user
    // token rather than caching per-page tokens in the session row -- avoids
    // a second encrypted-blob-inside-JSON scheme, and a token fetched at
    // the moment of connecting is no less correct than one cached minutes
    // earlier during the initial candidate-list fetch.
    const userToken = this.encryption.decrypt(session.userAccessToken);
    const freshPages = await this.fetchFacebookPages(userToken);
    const selected = freshPages.filter((p) => pageIds.includes(p.id));
    if (selected.length === 0) {
      throw new BadRequestException('No valid Pages selected.');
    }

    const connected: Array<{ channelId: string; pageId: string; pageName: string }> = [];
    for (const page of selected) {
      const subscribeRes = await fetch(
        `${GRAPH_API_BASE}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${page.access_token}`,
        { method: 'POST' },
      );
      const subscribeData = await subscribeRes.json() as { success?: boolean; error?: { message: string } };
      if (!subscribeData.success) {
        throw new BadRequestException(`Failed to subscribe "${page.name}" to Messenger webhooks: ${subscribeData.error?.message ?? 'unknown error'}`);
      }

      const channel = await this.upsertOAuthChannel(tenantId, ChannelType.FACEBOOK_MESSENGER, page.name, { pageId: page.id }, page.id);

      await this.prisma.facebookPageConnection.upsert({
        where: { tenantId_pageId: { tenantId, pageId: page.id } },
        update: {
          channelId: channel.id, pageName: page.name, pageAccessToken: this.encryption.encrypt(page.access_token),
          subscribedFields: ['messages', 'messaging_postbacks'], webhookVerified: true, isActive: true,
          connectedByUserId: userId, lastError: null, lastErrorAt: null,
        },
        create: {
          tenantId, channelId: channel.id, pageId: page.id, pageName: page.name,
          pageAccessToken: this.encryption.encrypt(page.access_token),
          subscribedFields: ['messages', 'messaging_postbacks'], webhookVerified: true,
          connectedByUserId: userId,
        },
      });

      connected.push({ channelId: channel.id, pageId: page.id, pageName: page.name });
    }

    await this.prisma.oAuthConnectSession.delete({ where: { id: sessionId } });

    return { connected };
  }
}
