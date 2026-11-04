import { PrismaClient, Prisma } from '@prisma/client';
import { CredentialRow, CredentialTarget } from './credential-reencryption';

/** A plain string column on a model addressed through its Prisma delegate. */
function stringTarget(name: string, d: {
  findMany(a: { where: Record<string, unknown>; orderBy: { id: 'asc' }; take: number; select: Record<string, true> }): Promise<Array<Record<string, unknown>>>;
  updateMany(a: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
}, column: string, nullable: boolean): CredentialTarget {
  return {
    name,
    jsonFields: [],
    async list(afterId, take): Promise<CredentialRow[]> {
      const rows = await d.findMany({ where: { ...(afterId ? { id: { gt: afterId } } : {}), ...(nullable ? { [column]: { not: null } } : {}) }, orderBy: { id: 'asc' }, take, select: { id: true, [column]: true } });
      return rows.map((r) => ({ id: r['id'] as string, raw: r[column] }));
    },
    async replace(id, expected, next) {
      return (await d.updateMany({ where: { id, [column]: expected }, data: { [column]: next } })).count === 1;
    },
  };
}

export function buildTargets(prisma: PrismaClient): CredentialTarget[] {
  return [
  stringTarget('whatsapp_numbers.access_token', prisma.whatsAppNumber as never, 'accessToken', false),
  stringTarget('facebook_page_connections.page_access_token', prisma.facebookPageConnection as never, 'pageAccessToken', false),
  stringTarget('oauth_connect_sessions.user_access_token', prisma.oAuthConnectSession as never, 'userAccessToken', false),
  stringTarget('tenants.access_token', prisma.tenant as never, 'accessToken', true),
  stringTarget('tenant_settings.airtable_api_key', prisma.tenantSettings as never, 'airtableApiKey', true),
  stringTarget('webhooks.secret', prisma.webhook as never, 'secret', true),
  stringTarget('whatsapp_web_sessions.encrypted_auth_state', prisma.whatsAppWebSession as never, 'encryptedAuthState', true),
  {
    name: 'channels.credentials',
    jsonFields: ['accessToken', 'refreshToken', 'botToken'],
    async list(afterId, take) {
      const rows = await prisma.channel.findMany({ where: afterId ? { id: { gt: afterId } } : {}, orderBy: { id: 'asc' }, take, select: { id: true, credentials: true } });
      return rows.map((r) => ({ id: r.id, raw: r.credentials }));
    },
    async replace(id, expected, next) {
      return (await prisma.channel.updateMany({ where: { id, credentials: { equals: expected as Prisma.InputJsonValue } }, data: { credentials: next as Prisma.InputJsonValue } })).count === 1;
    },
  },
  ];
}
