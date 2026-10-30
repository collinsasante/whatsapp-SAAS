import { Prisma } from '@prisma/client';
import { RawConversation } from './dataset-builder.util';

export interface ExportCursor { updatedAt: string; id: string }
export interface PageRequest { tenantId: string; from: Date; to: Date; after: ExportCursor | null; take: number }

/** The ONLY thing the exporter can do to the database: read one page. There is no write method to call, by construction. */
export interface ExportSource {
  readPage(req: PageRequest): Promise<RawConversation[]>;
}

export interface ReadOnlyClient {
  $transaction<T>(fn: (tx: Pick<Prisma.TransactionClient, '$executeRawUnsafe' | 'conversation'>) => Promise<T>): Promise<T>;
}

/**
 * Reads through a transaction that the database itself marks READ ONLY, so even a mistake in this file cannot write. Always scoped to
 * one tenant and a time window, ordered by (updatedAt, id) so a page boundary is a stable resume point.
 */
export class PrismaExportSource implements ExportSource {
  constructor(private readonly client: ReadOnlyClient) {}

  async readPage(req: PageRequest): Promise<RawConversation[]> {
    const after = req.after ? { updatedAt: new Date(req.after.updatedAt), id: req.after.id } : null;
    return this.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const rows = await tx.conversation.findMany({
        where: {
          tenantId: req.tenantId,
          AND: [
            { updatedAt: { gte: req.from, lt: req.to } },
            ...(after ? [{ OR: [{ updatedAt: { gt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { gt: after.id } }] }] : []),
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: req.take,
        select: {
          id: true, tenantId: true, updatedAt: true, createdAt: true,
          contact: { select: { name: true, phone: true, isEvalContact: true } },
          messages: {
            where: { type: 'TEXT', deletedForEveryone: false },
            orderBy: { createdAt: 'asc' },
            select: { id: true, direction: true, type: true, content: true, createdAt: true, metadata: true, deletedForEveryone: true, sender: { select: { isAiAgent: true, name: true } } },
          },
          aiInteractionEvaluations: {
            select: { status: true, overallScore: true, failureCategories: true, needsHumanReview: true, customerCorrectionDetected: true, humanTakeoverFollowed: true },
          },
        },
      });
      return rows.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
        contact: c.contact,
        messages: c.messages.map((m) => ({ ...m, type: String(m.type) })),
        evaluations: c.aiInteractionEvaluations.map((e) => ({ ...e, status: String(e.status), failureCategories: e.failureCategories.map(String) })),
      }));
    });
  }
}
