/**
 * REAL-DATABASE integration tests for Verz AI conversation context (Phase 1). These run against PostgreSQL: they need
 * DATABASE_URL pointing at a disposable, fully migrated database (see .env.test.example) and run with
 *   pnpm test:e2e -- ai-history        (jest --config test/jest-e2e.json --runInBand)
 * They are NOT part of the default unit run. They use the production code: the history loader and selector, the v2
 * ContextAssemblyStage, the legacy AiResponderService, CommerceAiService and the real KnowledgeBaseService. Only the model
 * provider (axios / the tool-calling engine) is replaced; nothing here makes a model call.
 */
import axios from 'axios';
import { UserRole } from '@whatsapp-platform/shared-types';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';
import { loadHistory } from '../src/ai-core/context/history-loader.util';
import { buildConversationHistoryWhere, buildHistoryWhere } from '../src/ai-core/context/history-scope.util';
import { ContextAssemblyStage } from '../src/ai-core/pipeline/stages/context-assembly.stage';
import { KbRelevantContextSource } from '../src/ai-core/pipeline/knowledge-context.source';
import { AiResponderService } from '../src/ai/ai-responder.service';
import { CommerceAiService } from '../src/commerce/ai/commerce-ai.service';
import { KnowledgeBaseService } from '../src/knowledge-base/knowledge-base.service';

jest.mock('axios');

const prisma = testPrisma as never;
const at = (ms: number) => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + ms);

async function seedConversation(tenantId: string, phone = '+233200000001') {
  const contact = await testPrisma.contact.create({ data: { tenantId, phone, name: 'Kwame' } });
  const conversation = await testPrisma.conversation.create({ data: { tenantId, contactId: contact.id, status: 'OPEN' } });
  return { contact, conversation };
}

async function say(
  tenantId: string, conversationId: string, contactId: string,
  direction: 'INBOUND' | 'OUTBOUND', content: string, createdAt: Date, id?: string,
) {
  return testPrisma.message.create({
    data: { ...(id ? { id } : {}), tenantId, conversationId, contactId, direction, type: 'TEXT', content, status: direction === 'INBOUND' ? 'DELIVERED' : 'SENT', createdAt },
  });
}

const texts = (turns: Array<{ content: string }>) => turns.map((t) => t.content);

describe('Verz AI conversation context against PostgreSQL (Phase 1)', () => {
  beforeEach(async () => { await resetTestDatabase(); });
  afterAll(async () => { await disconnectTestDatabase(); });

  it('answers each of several quick messages in order: no duplicate, no message from the future, replies kept', async () => {
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    const ids = ['m1', 'm2', 'm3'].map((k) => `${k}-00000000-0000-4000-8000-000000000000`.slice(0, 36));
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'Hi', at(0), ids[0]);
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'I want shea butter', at(1), ids[1]);
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'how much is 500g?', at(2), ids[2]);
    const where = buildConversationHistoryWhere(tenant.id, conversation.id);

    // Job 1 runs before any reply exists.
    expect(texts((await loadHistory(prisma, where, 12, ids[0])).turns)).toEqual([]);
    await say(tenant.id, conversation.id, contact.id, 'OUTBOUND', 'Hello! How can I help?', at(3));
    // Job 2: sees the first message and the reply stored after it; not the third message.
    expect(texts((await loadHistory(prisma, where, 12, ids[1])).turns)).toEqual(['Hi', 'Hello! How can I help?']);
    await say(tenant.id, conversation.id, contact.id, 'OUTBOUND', 'We have 250g and 500g.', at(4));
    // Job 3: both replies, both earlier messages, and the message itself exactly once (not in the history at all).
    const third = await loadHistory(prisma, where, 12, ids[2]);
    expect(texts(third.turns)).toEqual(['Hi', 'I want shea butter', 'Hello! How can I help?', 'We have 250g and 500g.']);
    expect(texts(third.turns)).not.toContain('how much is 500g?');
  });

  it('orders messages stored in the same millisecond consistently, whichever one is being answered', async () => {
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    const same = at(500);
    const a = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'first', same, '00000000-0000-4000-8000-00000000000a');
    const b = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'second', same, '00000000-0000-4000-8000-00000000000b');
    const c = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'third', same, '00000000-0000-4000-8000-00000000000c');
    const where = buildConversationHistoryWhere(tenant.id, conversation.id);

    expect(texts((await loadHistory(prisma, where, 12, a.id)).turns)).toEqual([]);
    expect(texts((await loadHistory(prisma, where, 12, b.id)).turns)).toEqual(['first']);
    expect(texts((await loadHistory(prisma, where, 12, c.id)).turns)).toEqual(['first', 'second']);
    // Repeating the query gives the same answer: the order is fully determined.
    expect(texts((await loadHistory(prisma, where, 12, b.id)).turns)).toEqual(['first']);
  });

  it('keeps every job coherent when 8 messages are written concurrently and answered one at a time', async () => {
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    // Written concurrently, as quick WhatsApp fragments are: the database decides the order.
    const written = await Promise.all(Array.from({ length: 8 }, (_, i) => say(tenant.id, conversation.id, contact.id, 'INBOUND', `fragment ${i}`, new Date(), undefined)));
    const where = buildConversationHistoryWhere(tenant.id, conversation.id);
    const order = [...written].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || (x.id < y.id ? -1 : 1));

    // The per-conversation lock runs the jobs one after another; each stores its reply before the next starts.
    const replies: string[] = [];
    for (let k = 0; k < order.length; k++) {
      const seen = texts((await loadHistory(prisma, where, 50, order[k].id)).turns);
      const expected = [...order.slice(0, k).map((m) => m.content as string), ...replies];
      expect([...seen].sort()).toEqual([...expected].sort());               // same set: nothing missing, nothing extra
      expect(seen).not.toContain(order[k].content);                          // never itself
      expect(new Set(seen).size).toBe(seen.length);                          // never a duplicate
      const reply = `reply ${k}`;
      replies.push(reply);
      await say(tenant.id, conversation.id, contact.id, 'OUTBOUND', reply, new Date(Date.now() + 60_000 + k));
    }
  });

  it('non-TEXT inbound rows: captions, taps and locations become turns in order; notes, audio, documents and attachment data never do; other tenants and conversations stay out', async () => {
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const other = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    const second = await seedConversation(tenant.id, '+233200000002');
    const foreign = await seedConversation(other.tenant.id, '+233200000003');
    const row = (t: string, c: string, ct: string, direction: 'INBOUND' | 'OUTBOUND', type: string, data: Record<string, unknown>, ms: number, id?: string) =>
      testPrisma.message.create({ data: { ...(id ? { id } : {}), tenantId: t, conversationId: c, contactId: ct, direction, type: type as never, status: 'DELIVERED', createdAt: at(ms), ...data } as never });

    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'IMAGE', { content: null, mediaCaption: 'do you have this one?', mediaUrl: 'https://private.example/a.jpg', mediaType: 'image/jpeg' }, 0);
    await row(tenant.id, conversation.id, contact.id, 'OUTBOUND', 'TEXT', { content: 'Yes, we do.' }, 1);
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'IMAGE', { content: null, mediaCaption: null, mediaUrl: 'https://private.example/b.jpg' }, 2);
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'AUDIO', { content: null, mediaUrl: 'https://private.example/v.ogg', mediaType: 'audio/ogg' }, 3);
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'DOCUMENT', { content: null, mediaCaption: 'passport-scan.pdf', mediaUrl: 'https://private.example/d.pdf' }, 4);
    await row(tenant.id, conversation.id, contact.id, 'OUTBOUND', 'NOTE', { content: 'INTERNAL: customer is difficult' }, 5);
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'INTERACTIVE', { content: 'Delivery' }, 6);
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'LOCATION', { content: 'Osu, Accra' }, 7);
    await row(tenant.id, second.conversation.id, second.contact.id, 'INBOUND', 'IMAGE', { content: null, mediaCaption: 'SECOND CONVERSATION' }, 8);
    await row(foreign.conversation.tenantId, foreign.conversation.id, foreign.contact.id, 'INBOUND', 'IMAGE', { content: null, mediaCaption: 'OTHER TENANT' }, 9);
    const currentId = '99999999-0000-4000-8000-000000000000';
    await row(tenant.id, conversation.id, contact.id, 'INBOUND', 'TEXT', { content: 'how much?' }, 10, currentId);

    const h = await loadHistory(prisma, buildConversationHistoryWhere(tenant.id, conversation.id), 12, currentId);
    expect(texts(h.turns)).toEqual(['do you have this one?', 'Yes, we do.', 'Delivery', 'Osu, Accra']);
    expect(h.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'user']);
    const all = JSON.stringify(h);
    for (const leak of ['private.example', 'image/jpeg', 'passport-scan', 'INTERNAL', 'SECOND CONVERSATION', 'OTHER TENANT']) expect(all).not.toContain(leak);

    // Contact scope (legacy responder) takes the same rows from the same contact only.
    const legacy = await loadHistory(prisma, buildHistoryWhere(tenant.id, { id: conversation.id, contactId: contact.id }), 12, currentId);
    expect(texts(legacy.turns)).toEqual(texts(h.turns));
  });

  it('v2 ContextAssemblyStage builds the same history from real rows and hands the knowledge source the customer\'s earlier messages', async () => {
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'I want shea butter', at(0));
    await say(tenant.id, conversation.id, contact.id, 'OUTBOUND', 'We have 250g and 500g.', at(1));
    const current = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'and the 500g?', at(2));
    const later = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'and delivery?', at(3));
    const getContext = jest.fn().mockResolvedValue('');
    const stage = new ContextAssemblyStage(prisma, { getState: jest.fn().mockResolvedValue(null) } as never, { getContext } as never);
    const ctx = { input: { tenantId: tenant.id, conversationId: conversation.id, currentMessageId: current.id }, customerMessage: 'and the 500g?', trace: { stageTimings: {} } };

    await stage.execute(ctx as never);

    expect((ctx as unknown as { historyMessages: Array<{ content: string }> }).historyMessages.map((m) => m.content)).toEqual(['I want shea butter', 'We have 250g and 500g.']);
    expect(getContext).toHaveBeenCalledWith(tenant.id, 'and the 500g?', ['I want shea butter']);
    expect(later.id).toBeTruthy();
  });

  it('legacy AiResponderService reads the returning customer\'s earlier conversation, answers around the stored message, and never reads another tenant', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    const A = await createTenantWithUser({ role: UserRole.ADMIN, tenantName: 'Kente Shop' });
    const B = await createTenantWithUser({ role: UserRole.ADMIN, tenantName: 'Other Shop' });
    const mine = await seedConversation(A.tenant.id, '+233200000001');
    const theirs = await seedConversation(B.tenant.id, '+233200000001'); // same phone number, different tenant
    const old = await testPrisma.conversation.create({ data: { tenantId: A.tenant.id, contactId: mine.contact.id, status: 'RESOLVED' } });
    await say(A.tenant.id, old.id, mine.contact.id, 'INBOUND', 'I bought shea butter last week', at(0));
    await say(A.tenant.id, old.id, mine.contact.id, 'OUTBOUND', 'Thank you!', at(1));
    await say(B.tenant.id, theirs.conversation.id, theirs.contact.id, 'INBOUND', 'SECRET from the other tenant', at(2));
    const current = await say(A.tenant.id, mine.conversation.id, mine.contact.id, 'INBOUND', 'is it back in stock', at(5));
    await say(A.tenant.id, mine.conversation.id, mine.contact.id, 'INBOUND', 'hello?', at(6));
    const post = axios.post as jest.Mock;
    post.mockReset();
    post.mockResolvedValue({ data: { choices: [{ message: { content: '{"response":"Yes, it is.","confidence":90}' } }] } });
    const service = new AiResponderService(prisma, new KnowledgeBaseService(prisma, {} as never));

    const result = await service.generateSuggestion(A.tenant.id, mine.conversation.id, 'is it back in stock', undefined, undefined, current.id);

    expect(result.response).toBe('Yes, it is.');
    const sent = (post.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> }).messages.slice(1).map((m) => `${m.role}: ${m.content}`);
    expect(sent).toEqual(['user: I bought shea butter last week', 'assistant: Thank you!', 'user: is it back in stock']);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
  });

  it('refuses another tenant\'s conversation id: no history, no query leaks', async () => {
    const A = await createTenantWithUser({ role: UserRole.ADMIN });
    const B = await createTenantWithUser({ role: UserRole.ADMIN });
    const theirs = await seedConversation(B.tenant.id);
    await say(B.tenant.id, theirs.conversation.id, theirs.contact.id, 'INBOUND', 'SECRET', at(0));

    // v2 / Commerce scope: tenant A + tenant B's conversation id matches nothing.
    expect((await loadHistory(prisma, buildConversationHistoryWhere(A.tenant.id, theirs.conversation.id), 12, 'x')).turns).toEqual([]);
    // Legacy scope: the conversation lookup is tenant-scoped, so it cannot even be resolved.
    const unresolved = await testPrisma.conversation.findFirst({ where: { id: theirs.conversation.id, tenantId: A.tenant.id }, select: { id: true, contactId: true } });
    expect(unresolved).toBeNull();
    expect((await loadHistory(prisma, buildHistoryWhere(A.tenant.id, unresolved), 12, 'x')).turns).toEqual([]);
  });

  it('CommerceAiService reads history from real rows around the stored message', async () => {
    process.env.DEEPSEEK_API_KEY = 'test';
    const { tenant } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { contact, conversation } = await seedConversation(tenant.id);
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'Hi', at(0));
    const current = await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'do you have shea butter', at(1));
    await say(tenant.id, conversation.id, contact.id, 'INBOUND', 'and soap?', at(2));
    const complete = jest.fn().mockResolvedValue({ content: 'Yes we do.', toolTrace: [], failed: false, hitMaxIterations: false, sideEffects: [] });
    const service = new CommerceAiService(prisma, new KnowledgeBaseService(prisma, {} as never), { getState: jest.fn().mockResolvedValue(null), mergeState: jest.fn() } as never, { complete } as never);

    await service.handleMessage(tenant.id, conversation.id, contact.id, '+233200000001', 'do you have shea butter', undefined, undefined, { currentMessageId: current.id });

    const args = complete.mock.calls[0][0] as { historyMessages: Array<{ content: string }>; userMessage: string };
    expect(args.historyMessages.map((m) => m.content)).toEqual(['Hi']);
    expect(args.userMessage).toBe('do you have shea butter');
  });

  it('knowledge-base ranking over real rows: best match first, inactive and other tenants\' articles never returned', async () => {
    const A = await createTenantWithUser({ role: UserRole.ADMIN });
    const B = await createTenantWithUser({ role: UserRole.ADMIN });
    const article = (tenantId: string, title: string, content: string, isActive = true) => testPrisma.knowledgeBaseArticle.create({ data: { tenantId, title, content, isActive } });
    const rows = [
      ['Shea butter products', 'We sell raw shea butter 250g for GHS 45 and 500g for GHS 80.'],
      ['Black soap', 'African black soap bar is GHS 12.50.'],
      ['Delivery', 'We deliver in Accra for GHS 20 and to other regions for GHS 35. Delivery takes 1 to 3 days.'],
      ['Payment', 'You can pay with mobile money (MTN, Vodafone, AirtelTigo) or by card.'],
      ['Opening hours', 'We open Monday to Saturday from 8am to 6pm.'],
      ['Returns', 'You can return an unopened product within 7 days.'],
    ];
    for (const [t, c] of rows) await article(A.tenant.id, t, c);
    await article(A.tenant.id, 'Payment (old)', 'Old payment info: mobile money was not accepted.', false);
    await article(B.tenant.id, 'Payment', 'SECRET payment details of another tenant, mobile money.');
    const kb = new KnowledgeBaseService(prisma, {} as never);

    expect((await kb.getRelevant(A.tenant.id, 'can I pay with momo')).map((a) => a.title)).toEqual(['Payment']);
    expect((await kb.getRelevant(A.tenant.id, 'what time do you open'))[0].title).toBe('Opening hours');
    expect(await kb.getRelevant(A.tenant.id, 'Hi')).toEqual([]);
    expect(await kb.getRelevant(A.tenant.id, 'do you sell laptops')).toEqual([]);
    expect((await kb.getRelevant(A.tenant.id, 'and how much for delivery?', ['I want shea butter'])).slice(0, 1).map((a) => a.title)).toEqual(['Delivery']);
    const all = JSON.stringify(await kb.getRelevant(A.tenant.id, 'mobile money payment'));
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain('old payment');
    expect(new KbRelevantContextSource(kb)).toBeTruthy();
  });
});
