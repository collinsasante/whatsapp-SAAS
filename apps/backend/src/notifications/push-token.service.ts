import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Expo push tokens, one row per device. Upsert-by-token rather than
 * check-then-write: the same device token re-registering (app reopen, token
 * refresh) is the overwhelmingly common case and must never create a
 * duplicate row.
 *
 * Known limitation: stale tokens are pruned only when Expo's send API
 * reports DeviceNotRegistered synchronously (see ExpoPushService) -- Expo's
 * fuller receipt-based error reporting (checking /getReceipts some time
 * after sending) is not implemented. A token that goes bad between sends
 * simply fails silently on the next push, same as a message send failing
 * for a disconnected client elsewhere in this codebase.
 */
@Injectable()
export class PushTokenService {
  private readonly logger = new Logger(PushTokenService.name);

  constructor(private prisma: PrismaService) {}

  async register(userId: string, tenantId: string, token: string, platform: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, tenantId, token, platform },
      update: { userId, tenantId, platform },
    });
  }

  async unregister(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }

  async getTokensForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
    return rows.map((r) => r.token);
  }

  async pruneInvalid(tokens: string[]) {
    if (tokens.length === 0) return;
    await this.prisma.pushToken.deleteMany({ where: { token: { in: tokens } } }).catch((err) =>
      this.logger.warn(`Failed to prune invalid push tokens: ${String(err)}`),
    );
  }
}
