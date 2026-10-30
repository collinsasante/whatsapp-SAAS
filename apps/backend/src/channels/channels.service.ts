import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppNumbersService } from '../whatsapp-numbers/whatsapp-numbers.service';
import { CredentialsEncryptionService } from '../common/crypto/credentials-encryption.service';
import { AuditService } from '../audit/audit.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { ChannelType, Prisma } from '@prisma/client';

/**
 * Webhook fields a Messenger Page is subscribed to. message_echoes carries replies a person sent outside VerzChat
 * (Page inbox, Business Suite, the app on another device); without it those replies never reach the inbox.
 * message_deliveries and message_reads drive the delivered and read ticks.
 */
export const MESSENGER_PAGE_FIELDS = ['messages', 'messaging_postbacks', 'message_echoes', 'message_deliveries', 'message_reads'];

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';
const GRAPH_HOST_PREFIX = 'https://graph.facebook.com/';
// Meta returns accounts in batches and names the next batch in paging.next. 100 per request, at most 20 requests
// (2,000 accounts) so a misbehaving response can never loop forever.
const GRAPH_BATCH_SIZE = 100;
const GRAPH_MAX_BATCHES = 20;

interface FacebookCandidatePage {
  id: string;
  name: string;
  access_token: string;
}

interface InstagramCandidate {
  page: FacebookCandidatePage;
  igId: string;
  /** What the person recognises: @username when Meta gives one. */
  label: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private whatsAppNumbers: WhatsAppNumbersService,
    private encryption: CredentialsEncryptionService,
    private audit: AuditService,
  ) {}

  async findAll(tenantId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { whatsAppWebSession: { select: { id: true, status: true, phoneNumber: true, lastError: true } } },
    });
    // Flatten the WhatsAppWebSession relation onto the returned row only for
    // WHATSAPP_WEB channels -- every other channel type's row shape is
    // unchanged from before this field existed.
    return channels.map(({ whatsAppWebSession, ...channel }) =>
      channel.type === ChannelType.WHATSAPP_WEB && whatsAppWebSession
        ? { ...channel, sessionId: whatsAppWebSession.id, whatsappWebStatus: whatsAppWebSession.status, phoneNumber: whatsAppWebSession.phoneNumber, lastError: whatsAppWebSession.lastError }
        : channel,
    );
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
    const created = await this.prisma.channel.create({
      data: {
        tenantId,
        type: dto.type as ChannelType,
        name: dto.name,
        credentials: mergedCredentials as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    void this.audit.log({
      tenantId, userId: actorId, action: 'CREATE', resource: 'channel', resourceId: created.id,
      metadata: { type: created.type, name: created.name },
    });

    return created;
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

    const updated = await this.prisma.channel.update({
      where: { id },
      data: {
        ...(dto.name       !== undefined && { name:      dto.name }),
        ...(dto.isActive   !== undefined && { isActive:  dto.isActive }),
        ...(credentialsUpdate            && { credentials: credentialsUpdate }),
        ...(dto.metadata                 && { metadata:  dto.metadata as Prisma.InputJsonValue }),
      },
    });

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'channel', resourceId: id,
      metadata: { changes: Object.keys(dto).filter((k) => k !== 'accessToken' && k !== 'credentials') },
    });

    return updated;
  }

  async toggle(tenantId: string, id: string, actorId?: string) {
    const channel = await this.findOne(tenantId, id);
    const nextActive = !channel.isActive;

    const updated = await this.prisma.channel.update({
      where: { id },
      data: { isActive: nextActive },
    });

    // Facebook Pages track their own isActive on FacebookPageConnection
    // (checked by FacebookMessengerService.resolveCredentials before every
    // send) -- keep it in lockstep with the generic Channel row so toggling
    // "Disconnect" here actually blocks sending, not just flips a cosmetic
    // status badge nothing else reads.
    if (channel.type === ChannelType.FACEBOOK_MESSENGER) {
      await this.prisma.facebookPageConnection.updateMany({
        where: { tenantId, channelId: id },
        data: { isActive: nextActive, ...(nextActive && { lastError: null, lastErrorAt: null }) },
      });
    }

    void this.audit.log({
      tenantId, userId: actorId, action: 'UPDATE', resource: 'channel', resourceId: id,
      metadata: { action: 'TOGGLE', isActive: updated.isActive },
    });

    return updated;
  }

  async remove(tenantId: string, id: string, actorId?: string): Promise<{ success: true; removed: boolean }> {
    const channel = await this.findOne(tenantId, id);

    // Facebook Pages: soft-disconnect, never hard-delete -- Conversation.
    // channelId/Message.channelId (onDelete: SetNull) would otherwise
    // silently erase which Page a conversation's history belongs to the
    // moment the row disappears. Mirrors WhatsAppNumbersService.remove()'s
    // identical reasoning for WhatsApp numbers.
    // Instagram, TikTok and Telegram follow the same rule, but only when there is history to protect: an account
    // that never had a conversation (for example one connected by mistake) is removed outright, so it does not sit
    // in the list as a "disconnected" row forever. Every other channel type keeps its existing hard delete.
    const hasHistory = (
      channel.type === ChannelType.INSTAGRAM || channel.type === ChannelType.TIKTOK || channel.type === ChannelType.TELEGRAM
    ) && (await this.prisma.conversation.count({ where: { tenantId, channelId: id } })) > 0;
    const soft = channel.type === ChannelType.FACEBOOK_MESSENGER || hasHistory;

    if (channel.type === ChannelType.FACEBOOK_MESSENGER) {
      await this.prisma.facebookPageConnection.updateMany({
        where: { tenantId, channelId: id },
        data: { isActive: false },
      });
    }
    if (soft) {
      await this.prisma.channel.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.channel.delete({ where: { id } });
    }

    void this.audit.log({
      tenantId, userId: actorId, action: 'DELETE', resource: 'channel', resourceId: id,
      metadata: { type: channel.type, name: channel.name, softDisconnect: soft },
    });

    return { success: true, removed: !soft };
  }

  async connectOAuth(provider: string, tenantId: string, code: string, redirectUri: string) {
    if (provider === 'tiktok') {
      return this.connectTikTok(tenantId, code, redirectUri);
    }
    // Instagram goes through the account-selection flow (startInstagramAccountSelection). The old code here
    // connected every Instagram account behind every Page it could see, with no way to choose.
    if (provider === 'instagram') {
      throw new BadRequestException('Instagram accounts are connected through the account picker.');
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

  async connectTelegramBot(tenantId: string, botToken: string, actorId?: string) {
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

    return this.upsertOAuthChannel(tenantId, ChannelType.TELEGRAM, botName, { botToken }, botId, actorId);
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
    actorId?: string,
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
      const updated = await this.prisma.channel.update({
        where: { id: existing.id },
        data: { name, externalId, credentials: credentialsWithId as Prisma.InputJsonValue, isActive: true },
      });

      void this.audit.log({
        tenantId, userId: actorId, action: 'UPDATE', resource: 'channel', resourceId: updated.id,
        metadata: { action: 'OAUTH_RECONNECT', type, name },
      });

      return updated;
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

    const created = await this.prisma.channel.create({
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

    void this.audit.log({
      tenantId, userId: actorId, action: 'CREATE', resource: 'channel', resourceId: created.id,
      metadata: { action: 'OAUTH_CONNECT', type, name: candidateName },
    });

    return created;
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

  /**
   * Every account the user manages, across all of Meta's batches. Reading only the first batch silently dropped
   * everything after it for anyone with many Pages.
   */
  private async fetchAllAccounts<T>(userToken: string, fields: string): Promise<T[]> {
    const all: T[] = [];
    let url: string | undefined = `${GRAPH_API_BASE}/me/accounts?limit=${GRAPH_BATCH_SIZE}&fields=${encodeURIComponent(fields)}&access_token=${userToken}`;
    for (let batch = 0; url && batch < GRAPH_MAX_BATCHES; batch++) {
      const res: Response = await fetch(url);
      const data = await res.json() as { data?: T[]; paging?: { next?: string }; error?: { message: string } };
      if (data.error) throw new Error(`Failed to list Facebook Pages: ${data.error.message}`);
      all.push(...(data.data ?? []));
      const next: string | undefined = data.paging?.next;
      // paging.next carries the access token; only ever follow it to Meta's own host.
      url = next && next.startsWith(GRAPH_HOST_PREFIX) ? next : undefined;
    }
    // Counts only. When someone connects "fewer accounts than I have", this line says whether Meta sent them all.
    this.logger.log(`Meta returned ${all.length} account(s) from /me/accounts`);
    return all;
  }

  /**
   * Logs which permissions the person actually granted the app, and for how many Pages each one applies. Meta only
   * returns the Pages they ticked in its login dialog, so this is what tells "Meta gave us 12" apart from "we dropped
   * some". Counts and permission names only: never the token, Page names or ids. Never throws.
   */
  private async logGrantedAccess(userToken: string): Promise<void> {
    try {
      const appId = this.config.get<string>('FACEBOOK_APP_ID');
      const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET');
      if (!appId || !appSecret) return;
      const res = await fetch(`${GRAPH_API_BASE}/debug_token?input_token=${userToken}&access_token=${appId}|${appSecret}`);
      const data = (await res.json() as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }>; scopes?: string[] } }).data;
      if (!data) return;
      const granted = (data.granular_scopes ?? []).map((g) => `${g.scope}=${g.target_ids?.length ?? 0} target(s)`).join(', ');
      this.logger.log(`Meta access granted to this login: scopes [${(data.scopes ?? []).join(', ')}]; per-asset: ${granted || 'none listed'}`);
    } catch (err) {
      this.logger.warn(`Could not read the granted access for this login: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  private fetchFacebookPages(userToken: string): Promise<FacebookCandidatePage[]> {
    return this.fetchAllAccounts<FacebookCandidatePage>(userToken, 'id,name,access_token');
  }

  /** Instagram accounts reachable through the Pages the user granted, with the Page token needed to act for each. */
  private async fetchInstagramCandidates(userToken: string): Promise<{ candidates: InstagramCandidate[]; pagesChecked: number }> {
    const pages = await this.fetchAllAccounts<FacebookCandidatePage & { instagram_business_account?: { id: string; username?: string; name?: string } }>(
      userToken, 'id,name,access_token,instagram_business_account{id,username,name}',
    );
    const candidates = pages.flatMap((page) => {
      const ig = page.instagram_business_account;
      if (!ig?.id) return [];
      const label = ig.username ? `@${ig.username}` : (ig.name ?? page.name);
      return [{ page: { id: page.id, name: page.name, access_token: page.access_token }, igId: ig.id, label }];
    });
    return { candidates, pagesChecked: pages.length };
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
    await this.logGrantedAccess(longLivedToken);

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

  /**
   * Called from the OAuth callback for provider=instagram. Same shape as the Facebook flow: list the accounts,
   * stash them in a short-lived session, let the user choose. Nothing is connected until they do.
   */
  async startInstagramAccountSelection(tenantId: string, userId: string, code: string, redirectUri: string): Promise<{ sessionId: string; accountCount: number }> {
    void this.prisma.oAuthConnectSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    const shortLivedToken = await this.exchangeFacebookCode(code, redirectUri);
    const longLivedToken = await this.exchangeForLongLivedToken(shortLivedToken);
    const { candidates, pagesChecked } = await this.fetchInstagramCandidates(longLivedToken);
    this.logger.log(`Instagram: ${candidates.length} account(s) found across ${pagesChecked} Page(s)`);
    await this.logGrantedAccess(longLivedToken);

    if (candidates.length === 0) {
      throw new Error(
        `No Instagram Business accounts found among the ${pagesChecked} Page${pagesChecked === 1 ? '' : 's'} you shared. ` +
        'Make sure the Instagram account is a Professional account linked to one of those Pages, and tick that Page when Meta asks.',
      );
    }

    const session = await this.prisma.oAuthConnectSession.create({
      data: {
        tenantId,
        createdByUserId: userId,
        provider: 'instagram',
        userAccessToken: this.encryption.encrypt(longLivedToken),
        candidatePages: candidates.map((c) => ({ id: c.igId, name: c.label, pageId: c.page.id, pageName: c.page.name })) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    return { sessionId: session.id, accountCount: candidates.length };
  }

  /** Candidate list for a pending selection session (Facebook Pages or Instagram accounts) -- never the token. */
  async getConnectSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.oAuthConnectSession.findFirst({
      where: { id: sessionId, tenantId, provider: { in: ['facebook', 'instagram'] }, expiresAt: { gt: new Date() } },
    });
    if (!session) throw new NotFoundException('This connection session has expired or does not exist. Please reconnect.');

    const candidatePages = session.candidatePages as unknown as Array<{ id: string; name: string; pageName?: string }>;
    const existingChannels = await this.prisma.channel.findMany({
      where: {
        tenantId,
        type: session.provider === 'instagram' ? ChannelType.INSTAGRAM : ChannelType.FACEBOOK_MESSENGER,
        externalId: { in: candidatePages.map((p) => p.id) },
      },
      select: { externalId: true },
    });
    const alreadyConnectedIds = new Set(existingChannels.map((c) => c.externalId));

    return {
      provider: session.provider as 'facebook' | 'instagram',
      candidatePages: candidatePages.map((p) => ({ ...p, alreadyConnected: alreadyConnectedIds.has(p.id) })),
    };
  }

  /** Connects the chosen accounts from a pending session, whichever platform started it. */
  async selectFromSession(tenantId: string, userId: string, sessionId: string, ids: string[]) {
    const session = await this.prisma.oAuthConnectSession.findFirst({
      where: { id: sessionId, tenantId, expiresAt: { gt: new Date() } },
      select: { provider: true },
    });
    if (!session) throw new NotFoundException('This connection session has expired or does not exist. Please reconnect.');
    if (session.provider === 'instagram') return this.selectInstagramAccounts(tenantId, userId, sessionId, ids);
    return this.selectFacebookPages(tenantId, userId, sessionId, ids);
  }

  /**
   * Asks Meta to deliver this Page's messaging webhooks to the app. Best effort and never throws: the account is
   * connected either way, and the caller shows the person why messages may not arrive if Meta refused.
   */
  private async subscribePageToMessages(page: FacebookCandidatePage): Promise<{ subscribed: boolean; reason?: string }> {
    try {
      const res = await fetch(
        `${GRAPH_API_BASE}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${page.access_token}`,
        { method: 'POST' },
      );
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      return data.success ? { subscribed: true } : { subscribed: false, reason: data.error?.message ?? 'Meta did not confirm the subscription.' };
    } catch (err) {
      return { subscribed: false, reason: err instanceof Error ? err.message : 'Could not reach Meta.' };
    }
  }

  async selectInstagramAccounts(tenantId: string, userId: string, sessionId: string, igIds: string[]) {
    const session = await this.prisma.oAuthConnectSession.findFirst({
      where: { id: sessionId, tenantId, provider: 'instagram', expiresAt: { gt: new Date() } },
    });
    if (!session) throw new NotFoundException('This connection session has expired or does not exist. Please reconnect.');

    const candidates = session.candidatePages as unknown as Array<{ id: string }>;
    const validIds = new Set(candidates.map((c) => c.id));
    if (!igIds.every((id) => validIds.has(id))) {
      throw new BadRequestException('One or more selected accounts were not in the original list.');
    }

    // Tokens are fetched fresh from the stored user token at the moment of connecting, as the Facebook flow does.
    const { candidates: fresh } = await this.fetchInstagramCandidates(this.encryption.decrypt(session.userAccessToken));
    const selected = fresh.filter((c) => igIds.includes(c.igId));
    if (selected.length === 0) throw new BadRequestException('No valid accounts selected.');

    const connected: Array<{ channelId: string; accountId: string; accountName: string; webhookSubscription: { subscribed: boolean; reason?: string } }> = [];
    for (const c of selected) {
      const channel = await this.upsertOAuthChannel(tenantId, ChannelType.INSTAGRAM, c.label, {
        // Stored encrypted: GET /channels returns this JSON to the dashboard.
        accessToken: this.encryption.encrypt(c.page.access_token),
        pageId: c.page.id,
        igAccountId: c.igId,
      }, c.igId, userId);
      connected.push({ channelId: channel.id, accountId: c.igId, accountName: c.label, webhookSubscription: await this.subscribePageToMessages(c.page) });
    }

    await this.prisma.oAuthConnectSession.delete({ where: { id: sessionId } });
    return { connected };
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
        `${GRAPH_API_BASE}/${page.id}/subscribed_apps?subscribed_fields=${MESSENGER_PAGE_FIELDS.join(',')}&access_token=${page.access_token}`,
        { method: 'POST' },
      );
      const subscribeData = await subscribeRes.json() as { success?: boolean; error?: { message: string } };
      if (!subscribeData.success) {
        throw new BadRequestException(`Failed to subscribe "${page.name}" to Messenger webhooks: ${subscribeData.error?.message ?? 'unknown error'}`);
      }

      const channel = await this.upsertOAuthChannel(tenantId, ChannelType.FACEBOOK_MESSENGER, page.name, { pageId: page.id }, page.id, userId);

      await this.prisma.facebookPageConnection.upsert({
        where: { tenantId_pageId: { tenantId, pageId: page.id } },
        update: {
          channelId: channel.id, pageName: page.name, pageAccessToken: this.encryption.encrypt(page.access_token),
          subscribedFields: MESSENGER_PAGE_FIELDS, webhookVerified: true, isActive: true,
          connectedByUserId: userId, lastError: null, lastErrorAt: null,
        },
        create: {
          tenantId, channelId: channel.id, pageId: page.id, pageName: page.name,
          pageAccessToken: this.encryption.encrypt(page.access_token),
          subscribedFields: MESSENGER_PAGE_FIELDS, webhookVerified: true,
          connectedByUserId: userId,
        },
      });

      connected.push({ channelId: channel.id, pageId: page.id, pageName: page.name });
    }

    await this.prisma.oAuthConnectSession.delete({ where: { id: sessionId } });

    return { connected };
  }
}
