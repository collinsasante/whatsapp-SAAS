import { PrismaClient } from '@prisma/client';
import { decryptCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';

// Resolved once per process, same as CredentialsEncryptionService does per
// NestJS instance -- the worker has no DI container to hold this for it.
const ENCRYPTION_KEY = parseEncryptionKey(process.env['CREDENTIALS_ENCRYPTION_KEY']);

// Kept in sync with WhatsAppService.graphBaseUrl (apps/backend) -- this used
// to drift independently per processor (v20.0 here vs v23.0 there).
export const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Mirrors WhatsAppService.resolveCredentials() (apps/backend) for the
 * worker's standalone BullMQ processors, which have no NestJS DI/
 * ConfigService available to inject CredentialsEncryptionService or
 * WhatsAppNumbersService. Resolves from WhatsAppNumber (decrypted) when a
 * number id is given -- so a campaign/automation/retry send always goes out
 * from the exact number it actually belongs to -- falling back to the
 * tenant's legacy default fields (always stored plaintext, see
 * WhatsAppNumbersService.syncDefaultToTenant) only when no number is
 * specified at all. Returns null when nothing usable was found, matching
 * this file's callers' existing "skip if not configured" behavior.
 */
export async function resolveWhatsAppCredentials(
  prisma: PrismaClient,
  tenantId: string,
  whatsappNumberId?: string | null,
): Promise<WhatsAppCredentials | null> {
  if (whatsappNumberId) {
    const num = await prisma.whatsAppNumber.findFirst({
      where: { id: whatsappNumberId, tenantId, isActive: true },
    });
    if (!num) return null;
    return { phoneNumberId: num.phoneNumberId, accessToken: decryptCredential(num.accessToken, ENCRYPTION_KEY) };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { phoneNumberId: true, accessToken: true },
  });
  if (!tenant?.phoneNumberId || !tenant.accessToken) return null;
  return { phoneNumberId: tenant.phoneNumberId, accessToken: tenant.accessToken };
}
