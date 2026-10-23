import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { PageFetchError, UnsafePageUrlError, fetchPublicPage } from './public-page-fetch';

jest.mock('./public-page-fetch', () => ({ ...jest.requireActual('./public-page-fetch'), fetchPublicPage: jest.fn() }));
const fetchMock = fetchPublicPage as jest.Mock;

function build() {
  const prisma = {
    tenantSettings: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    knowledgeBaseArticle: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn(), delete: jest.fn() },
    conversation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const ai = { complete: jest.fn() };
  const service = new KnowledgeBaseService(prisma as never, ai as never);
  return { service, prisma, ai };
}

describe('KnowledgeBaseService.scrapeUrl', () => {
  beforeEach(() => fetchMock.mockReset());

  it('turns a refused address into a safe 400 and stores nothing', async () => {
    fetchMock.mockRejectedValue(new UnsafePageUrlError('That address cannot be used. Enter the address of a public website.'));
    const { service, prisma } = build();
    const err = await service.scrapeUrl('t1', 'http://169.254.169.254/').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('That address cannot be used. Enter the address of a public website.');
    expect(prisma.knowledgeBaseArticle.create).not.toHaveBeenCalled();
  });

  it('hides the cause of any other fetch failure', async () => {
    fetchMock.mockRejectedValue(new PageFetchError('request failed: ECONNREFUSED 10.0.0.9:5432'));
    const { service } = build();
    const err = await service.scrapeUrl('t1', 'https://example.com/').catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('Could not fetch URL. Make sure it is publicly accessible.');
    expect((err as Error).message).not.toMatch(/10\.0|5432|ECONN/);
  });

  it('still saves a normal public page as articles for the caller\'s workspace', async () => {
    fetchMock.mockResolvedValue({ finalUrl: 'https://example.com/', html: `<html><title>About us</title><body>${'We sell labels and packaging. '.repeat(5)}</body></html>` });
    const { service, prisma } = build();
    await expect(service.scrapeUrl('t1', 'https://example.com/')).resolves.toEqual({ created: 1 });
    expect(prisma.knowledgeBaseArticle.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 't1', title: 'About us', source: 'url', sourceRef: 'https://example.com/' }) });
  });
});

describe('KnowledgeBaseService learning switch and throttle', () => {
  const original = process.env.KB_LEARNING_DISABLED;
  afterEach(() => { if (original === undefined) delete process.env.KB_LEARNING_DISABLED; else process.env.KB_LEARNING_DISABLED = original; });

  it.each([[undefined], ['true'], ['TRUE'], [''], ['1'], ['yes']])('manual learning is refused when KB_LEARNING_DISABLED is %p, with no claim, no database read and no provider call', async (value) => {
    if (value === undefined) delete process.env.KB_LEARNING_DISABLED; else process.env.KB_LEARNING_DISABLED = value;
    const { service, prisma, ai } = build();
    await expect(service.learnNow('t1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.tenantSettings.updateMany).not.toHaveBeenCalled();
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('the background trigger obeys the same switch', async () => {
    delete process.env.KB_LEARNING_DISABLED;
    const { service, prisma } = build();
    const learn = jest.spyOn(service, 'learnFromConversations');
    await service.triggerLearningAsync('t1');
    expect(prisma.tenantSettings.updateMany).not.toHaveBeenCalled();
    expect(learn).not.toHaveBeenCalled();
  });

  it("runs only when explicitly set to 'false', and only after claiming the workspace's slot", async () => {
    process.env.KB_LEARNING_DISABLED = 'false';
    const { service, prisma } = build();
    const learn = jest.spyOn(service, 'learnFromConversations').mockResolvedValue({ created: 2 });
    await expect(service.learnNow('t1')).resolves.toEqual({ created: 2 });
    expect(prisma.tenantSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) }));
    expect(learn).toHaveBeenCalledWith('t1');
  });

  it('refuses with 429 and makes no provider call when this workspace already learned within the window', async () => {
    process.env.KB_LEARNING_DISABLED = 'false';
    const { service, prisma, ai } = build();
    prisma.tenantSettings.updateMany.mockResolvedValue({ count: 0 });
    const err = await service.learnNow('t1').catch((e: HttpException) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('two simultaneous requests start exactly one learning run', async () => {
    process.env.KB_LEARNING_DISABLED = 'false';
    const { service, prisma } = build();
    prisma.tenantSettings.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const learn = jest.spyOn(service, 'learnFromConversations').mockResolvedValue({ created: 0 });
    const results = await Promise.allSettled([service.learnNow('t1'), service.learnNow('t1')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(learn).toHaveBeenCalledTimes(1);
  });
});

describe('KnowledgeBaseService workspace isolation', () => {
  it("cannot edit or delete another workspace's article", async () => {
    const { service, prisma } = build();
    prisma.knowledgeBaseArticle.findFirst.mockResolvedValue(null); // the article exists, but not under tenant B
    await expect(service.update('tenant-B', 'article-of-A', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('tenant-B', 'article-of-A')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.knowledgeBaseArticle.findFirst).toHaveBeenCalledWith({ where: { id: 'article-of-A', tenantId: 'tenant-B' } });
    expect(prisma.knowledgeBaseArticle.update).not.toHaveBeenCalled();
    expect(prisma.knowledgeBaseArticle.delete).not.toHaveBeenCalled();
  });
});
