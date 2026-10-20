import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

export const LIBRARY_MEDIA_TYPES = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const;
export type LibraryMediaType = (typeof LIBRARY_MEDIA_TYPES)[number];

/**
 * "Sent by agents" means: an OUTBOUND message that a real, non-AI user sent from the inbox.
 * It deliberately excludes AI replies, chatbot/automation sends and campaign blasts, because those have no
 * human sender (sender_id is null) or are sent by the AI's synthetic user (users.is_ai_agent = true).
 */
export type MediaSource = 'all' | 'agents';

export interface MediaLibraryFilters {
  source?: MediaSource;
  /** One specific agent. Implies source=agents. */
  agentId?: string;
  type?: string;
  /** Stored Channel.type, e.g. WHATSAPP, WHATSAPP_WEB, FACEBOOK_MESSENGER. */
  channelType?: string;
  direction?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface NormalizedMediaFilters {
  source: MediaSource;
  agentId?: string;
  types: LibraryMediaType[];
  channelType?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  from?: Date;
  to?: Date;
  search?: string;
}

const CHANNEL_TYPES = ['WHATSAPP', 'WHATSAPP_WEB', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'TELEGRAM', 'EMAIL', 'WEB_CHAT', 'TIKTOK', 'TWITTER', 'LINKEDIN'];
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f-]{36}$/i;

function parseDate(value: string, which: 'from' | 'to'): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`"${which}" must be a valid date, for example 2026-10-15.`);
  // A plain date as the end of a range means the whole of that day.
  if (which === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(d.getTime() + DAY_MS - 1);
  return d;
}

/** Validates user input into a safe, typed filter. Unknown values are rejected, never passed to SQL. */
export function normalizeMediaFilters(f: MediaLibraryFilters): NormalizedMediaFilters {
  const type = f.type?.toUpperCase();
  if (type && !(LIBRARY_MEDIA_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Unknown media type.');
  const channelType = f.channelType?.toUpperCase();
  if (channelType && !CHANNEL_TYPES.includes(channelType)) throw new BadRequestException('Unknown channel.');
  const direction = f.direction?.toUpperCase();
  if (direction && direction !== 'INBOUND' && direction !== 'OUTBOUND') throw new BadRequestException('Direction must be INBOUND or OUTBOUND.');
  if (f.source && f.source !== 'all' && f.source !== 'agents') throw new BadRequestException('Source must be "all" or "agents".');
  if (f.agentId && !UUID.test(f.agentId)) throw new BadRequestException('Unknown agent.');

  const from = f.from ? parseDate(f.from, 'from') : undefined;
  const to = f.to ? parseDate(f.to, 'to') : undefined;
  if (from && to && from.getTime() > to.getTime()) throw new BadRequestException('"from" must be on or before "to".');

  const agents = f.source === 'agents' || !!f.agentId;
  // Agent media is by definition outbound; asking for inbound agent media is a contradiction, so say so.
  if (agents && direction === 'INBOUND') throw new BadRequestException('Media sent by agents is always outbound.');

  return {
    source: agents ? 'agents' : 'all',
    agentId: f.agentId,
    types: type ? [type as LibraryMediaType] : [...LIBRARY_MEDIA_TYPES],
    channelType,
    direction: agents ? 'OUTBOUND' : (direction as 'INBOUND' | 'OUTBOUND' | undefined),
    from,
    to,
    search: f.search?.trim() || undefined,
  };
}

/** The WHERE conditions, always led by the tenant. Every value is a bound parameter. */
export function buildMediaWhere(tenantId: string, f: NormalizedMediaFilters): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`m.tenant_id = ${tenantId}`,
    Prisma.sql`m.media_url IS NOT NULL`,
    Prisma.sql`m.type::text IN (${Prisma.join(f.types)})`,
  ];
  if (f.source === 'agents') {
    conds.push(Prisma.sql`m.direction = 'OUTBOUND'::"MessageDirection"`);
    conds.push(Prisma.sql`m.sender_id IS NOT NULL`);
    conds.push(Prisma.sql`u.is_ai_agent = false`);
  } else if (f.direction) {
    conds.push(Prisma.sql`m.direction::text = ${f.direction}`);
  }
  if (f.agentId) conds.push(Prisma.sql`m.sender_id = ${f.agentId}`);
  if (f.channelType) conds.push(Prisma.sql`ch.type::text = ${f.channelType}`);
  if (f.from) conds.push(Prisma.sql`m.created_at >= ${f.from}`);
  if (f.to) conds.push(Prisma.sql`m.created_at <= ${f.to}`);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(Prisma.sql`(c.name ILIKE ${like} OR m.media_caption ILIKE ${like})`);
  }
  return Prisma.join(conds, ' AND ');
}

// Contacts and conversations are joined WITH the tenant, so a row can never pull in another workspace's data.
// The sender is joined by id only: invited team members keep their home-workspace user row.
export const MEDIA_JOINS = Prisma.sql`
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN contacts c ON c.id = m.contact_id AND c.tenant_id = m.tenant_id
  LEFT JOIN conversations cv ON cv.id = m.conversation_id AND cv.tenant_id = m.tenant_id
  LEFT JOIN channels ch ON ch.id = cv.channel_id AND ch.tenant_id = m.tenant_id`;
