import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cross-replica mutual exclusion for one conversation's AI turns, backed by a row lease in PostgreSQL (`ai_conversation_leases`).
 *
 * Acquire is a single atomic statement: insert the row, or take it over only when the previous lease has expired. The holder renews the lease while it
 * works (so a long provider call keeps it) and deletes it when done; if the process dies the lease simply expires, so a crash can never wedge a
 * conversation. Waiters poll. If the lease cannot be had within `maxWaitMs` the caller gets `LeaseTimeoutError` and the turn is skipped rather than run
 * unsynchronised (a duplicate paid call and a duplicate reply are worse than a skipped automatic reply the agent can still answer by hand).
 *
 * Fail-open only for infrastructure faults: if the lease table is unavailable (for example the migration has not been applied yet) the caller proceeds
 * with the in-process chain alone, which is the behaviour this replaced, and a warning is logged.
 */
export class LeaseTimeoutError extends Error {
  constructor(conversationId: string) { super(`Could not obtain the AI lease for conversation ${conversationId.slice(-6)} in time`); }
}

export interface LeaseOptions { ttlMs?: number; maxWaitMs?: number; pollMs?: number; owner?: string }

export class ConversationLease {
  private readonly logger = new Logger(ConversationLease.name);
  constructor(private readonly prisma: PrismaService, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  async acquire(tenantId: string, conversationId: string, owner: string, ttlMs: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ owner: string }>>`
      INSERT INTO ai_conversation_leases (conversation_id, tenant_id, owner, expires_at, acquired_at)
      VALUES (${conversationId}, ${tenantId}, ${owner}, now() + (${ttlMs} * interval '1 millisecond'), now())
      ON CONFLICT (conversation_id) DO UPDATE
        SET owner = EXCLUDED.owner, tenant_id = EXCLUDED.tenant_id, expires_at = EXCLUDED.expires_at, acquired_at = now()
        WHERE ai_conversation_leases.expires_at < now()
      RETURNING owner`;
    return rows.length === 1 && rows[0]!.owner === owner;
  }

  async renew(conversationId: string, owner: string, ttlMs: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`UPDATE ai_conversation_leases SET expires_at = now() + (${ttlMs} * interval '1 millisecond') WHERE conversation_id = ${conversationId} AND owner = ${owner}`;
    return n === 1;
  }

  async release(conversationId: string, owner: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM ai_conversation_leases WHERE conversation_id = ${conversationId} AND owner = ${owner}`;
  }

  async withLease<T>(tenantId: string, conversationId: string, fn: () => Promise<T>, opts: LeaseOptions = {}): Promise<T> {
    const ttlMs = opts.ttlMs ?? 90_000;
    const maxWaitMs = opts.maxWaitMs ?? 180_000;
    const pollMs = opts.pollMs ?? 250;
    const owner = opts.owner ?? randomUUID();
    const deadline = Date.now() + maxWaitMs;

    let held = false;
    try {
      while (!(held = await this.acquire(tenantId, conversationId, owner, ttlMs))) {
        if (Date.now() >= deadline) throw new LeaseTimeoutError(conversationId);
        await this.sleep(pollMs);
      }
    } catch (e) {
      if (e instanceof LeaseTimeoutError) throw e;
      this.logger.warn(`AI lease unavailable (${e instanceof Error ? e.name : 'error'}); continuing with the in-process lock only`);
      return fn();
    }

    const timer = setInterval(() => { void this.renew(conversationId, owner, ttlMs).catch(() => undefined); }, Math.max(50, Math.floor(ttlMs / 3)));
    try {
      return await fn();
    } finally {
      clearInterval(timer);
      await this.release(conversationId, owner).catch((e) => this.logger.warn(`AI lease release failed: ${e instanceof Error ? e.name : 'error'}`));
    }
  }
}
