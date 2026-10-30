import { Prisma } from '@prisma/client';
import { deriveStatus, emptyProfile, mergeFeatures, parseProfile, type WeightedFeatures } from './profile.util';
import type { MessageFeatures } from './message-features.util';

export const REPLY_SOURCE = 'REPLY';
export const CORRECTION_SOURCE = 'CORRECTION';
/** Weight of an approved style correction relative to one of the agent's own replies. */
export const CORRECTION_WEIGHT = 3;

/** Serialises everything that reads-modifies-writes one Digital Self (the learner, an admin edit, a reset, a removal). */
export async function lockDigitalSelf(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM digital_selves WHERE id = ${id} FOR UPDATE`);
}

/**
 * Takes a SHARED lock on the conversation row. A learner holds it for its whole transaction; switching a conversation's exclusion
 * on needs the exclusive row lock, so that write waits for every in-flight learner to finish and every later learner then sees
 * the flag. Without this, a learner that checked the flag a moment before it was switched could commit evidence after the
 * removal pass had already looked. Returns whether the conversation is currently excluded.
 */
export async function lockConversationAndReadExclusion(tx: Prisma.TransactionClient, tenantId: string, conversationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ excluded: boolean }>>(
    Prisma.sql`SELECT digital_self_learning_excluded AS excluded FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId} FOR SHARE`,
  );
  // A conversation that cannot be found cannot be shown to be allowed: treat it as excluded.
  return rows.length === 0 ? true : rows[0]!.excluded;
}

const NUMERIC: Array<keyof MessageFeatures> = ['words', 'sentences', 'formalMarkers', 'casualMarkers'];
const BOOLEAN: Array<keyof MessageFeatures> = ['endsWithQuestion', 'acknowledges', 'empathy', 'codeSwitch', 'lowercaseStart', 'hasQuestion', 'hasExclaim', 'hasEmoji', 'hasContraction'];

/** Stored event features are JSON from an earlier version of the code; only a complete, well-typed value is used. */
export function asMessageFeatures(value: unknown): MessageFeatures | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!NUMERIC.every((k) => typeof v[k] === 'number') || !BOOLEAN.every((k) => typeof v[k] === 'boolean')) return null;
  if (!Array.isArray(v['languages']) || !v['languages'].every((l) => typeof l === 'string')) return null;
  const nullableString = (x: unknown) => x === null || typeof x === 'string';
  if (!nullableString(v['greeting']) || !nullableString(v['closing'])) return null;
  return v as unknown as MessageFeatures;
}

const REBUILD_BATCH = 500;

/**
 * Recomputes a Digital Self's profile and counters from the events it still has. This is how evidence is removed exactly (a
 * conversation was excluded, a correction was withdrawn): the deleted events simply are not replayed. Business overrides are kept.
 * The caller must hold lockDigitalSelf for this id.
 */
export async function rebuildFromEvents(tx: Prisma.TransactionClient, tenantId: string, digitalSelfId: string): Promise<void> {
  const self = await tx.digitalSelf.findFirstOrThrow({ where: { id: digitalSelfId, tenantId } });
  let profile = { ...emptyProfile(), overrides: parseProfile(self.profile).overrides };
  let cursor: string | undefined;
  for (;;) {
    const events = await tx.digitalSelfLearningEvent.findMany({
      where: { digitalSelfId, tenantId, features: { not: Prisma.DbNull } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: REBUILD_BATCH,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (events.length === 0) break;
    const batch: WeightedFeatures[] = [];
    for (const e of events) {
      const features = asMessageFeatures(e.features);
      if (features) batch.push({ features, weight: e.weight, correction: e.source === CORRECTION_SOURCE });
    }
    profile = mergeFeatures(profile, batch);
    cursor = events[events.length - 1]!.id;
  }

  const [evidenceCount, latest] = await Promise.all([
    tx.digitalSelfLearningEvent.count({ where: { digitalSelfId, tenantId, source: REPLY_SOURCE } }),
    tx.digitalSelfLearningEvent.findFirst({ where: { digitalSelfId, tenantId, source: REPLY_SOURCE }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const lastLearnedAt = latest?.createdAt ?? null;
  await tx.digitalSelf.update({
    where: { id: digitalSelfId },
    data: {
      profile: profile as unknown as Prisma.InputJsonValue,
      profileVersion: { increment: 1 },
      evidenceCount,
      lastLearnedAt,
      status: deriveStatus({ evidenceCount, enabled: self.enabled, learningPaused: self.learningPaused, lastLearnedAt }),
    },
  });
}
