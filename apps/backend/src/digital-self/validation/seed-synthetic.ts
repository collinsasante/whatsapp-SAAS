import type { PrismaClient } from '@prisma/client';
import { simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { DigitalSelfLearningService } from '../digital-self-learning.service';
import { DigitalSelfService, AGENT_ROLES } from '../digital-self.service';

/** Marks the conversations this tool creates, so they can be found and removed again. */
export const SEED_SOURCE = 'synthetic_digital_self_seed';

/** Only a workspace whose name says it is not real. A name check is a guard against a typo, not a security boundary. */
export function assertSyntheticTenant(tenantName: string): void {
  if (!/(stage|staging|synthetic|test)/i.test(tenantName)) {
    throw new Error(`Refusing to seed workspace "${tenantName}": its name must contain "stage", "staging", "synthetic" or "test". Synthetic history must never be written into a real workspace.`);
  }
}

export interface SeedAgent {
  userId: string;
  /** Invented replies, cycled to reach `replies`. */
  persona: readonly string[];
}

/**
 * Writes invented outbound replies from the given agents into a synthetic workspace and runs the real learner over each, so a
 * staging validation has history to learn from. The normal route is not usable for this: the learner is queued only after a send
 * succeeds, and a send to the simulated test contact is refused by design. Nothing is sent to any channel, and the conversation is
 * tagged so cleanupSynthetic can remove it (and, through the exclusion machinery, what was learned from it).
 */
export async function seedSynthetic(prisma: PrismaClient, tenantId: string, agents: SeedAgent[], replies: number): Promise<{ created: number; learned: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  if (!tenant) throw new Error('Workspace not found');
  assertSyntheticTenant(tenant.name);

  const learning = new DigitalSelfLearningService(prisma as never);
  const service = new DigitalSelfService(prisma as never);
  let created = 0;
  let learned = 0;
  for (const agent of agents) {
    const user = await prisma.user.findFirst({ where: { id: agent.userId, tenantId, isAiAgent: false, role: { in: AGENT_ROLES } }, select: { id: true } });
    if (!user) throw new Error(`User ${agent.userId} is not a human agent of this workspace`);
    await service.ensureForUser(tenantId, user.id);

    const phone = simulatedPhoneFor(`seed-${user.id}`);
    const contact = (await prisma.contact.findFirst({ where: { tenantId, phone } })) ?? (await prisma.contact.create({ data: { tenantId, phone, name: 'Synthetic customer (Digital Self seed)' } }));
    const conversation = await prisma.conversation.create({ data: { tenantId, contactId: contact.id, contactSource: SEED_SOURCE, status: 'RESOLVED' } });
    for (let i = 0; i < replies; i++) {
      const content = agent.persona[i % agent.persona.length]!;
      const message = await prisma.message.create({ data: { tenantId, conversationId: conversation.id, contactId: contact.id, senderId: user.id, direction: 'OUTBOUND', type: 'TEXT', status: 'SENT', content, sentAt: new Date() } });
      created++;
      if ((await learning.learnFromMessage(tenantId, message.id)) === 'learned') learned++;
    }
  }
  return { created, learned };
}

/** Removes everything seedSynthetic created in the workspace: what was learned from it first (exclusion), then the conversations. */
export async function cleanupSynthetic(prisma: PrismaClient, tenantId: string): Promise<{ conversations: number; evidenceRemoved: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  if (!tenant) throw new Error('Workspace not found');
  assertSyntheticTenant(tenant.name);
  const service = new DigitalSelfService(prisma as never);
  const conversations = await prisma.conversation.findMany({ where: { tenantId, contactSource: SEED_SOURCE }, select: { id: true } });
  let evidenceRemoved = 0;
  for (const { id } of conversations) {
    evidenceRemoved += (await service.setConversationLearningExcluded(tenantId, id, true, { id: 'synthetic-seed-cli', role: 'ADMIN' })).evidenceRemoved;
    await prisma.conversation.delete({ where: { id } });
  }
  return { conversations: conversations.length, evidenceRemoved };
}
