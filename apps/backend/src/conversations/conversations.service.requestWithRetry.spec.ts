import { ConversationsService } from './conversations.service';

/**
 * Second hardening pass, Section 4: backend-enforced handoff truth. Kept as a
 * separate, minimal spec file (rather than added to a full conversations.service.spec.ts,
 * which doesn't exist yet) since requestWithRetry only calls this.request()
 * internally -- spied/stubbed directly here rather than mocking request()'s own
 * ~8 dependencies (Prisma, ActivityLog, Notifications, Realtime, Airtable,
 * ModuleRef, AiCompletion, the snooze BullMQ queue), none of which requestWithRetry
 * itself touches.
 */
function buildService() {
  const deps = {
    prisma: {}, activityLogService: {}, notificationsService: {}, realtimeService: {},
    airtableService: {}, moduleRef: {}, aiCompletionService: {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ConversationsService(deps.prisma as any, deps.activityLogService as any, deps.notificationsService as any, deps.realtimeService as any, deps.airtableService as any, deps.moduleRef as any, deps.aiCompletionService as any, {} as any);
}

describe('ConversationsService.requestWithRetry', () => {
  it('returns true immediately when the first attempt succeeds', async () => {
    const service = buildService();
    const requestSpy = jest.spyOn(service, 'request').mockResolvedValue({} as never);

    const result = await service.requestWithRetry('t1', 'conv1', 'reason');

    expect(result).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once and returns true if the retry succeeds', async () => {
    const service = buildService();
    const requestSpy = jest.spyOn(service, 'request')
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({} as never);

    const result = await service.requestWithRetry('t1', 'conv1', 'reason');

    expect(result).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('returns false (never throws) when both the first attempt and the retry fail', async () => {
    const service = buildService();
    const requestSpy = jest.spyOn(service, 'request').mockRejectedValue(new Error('down'));

    await expect(service.requestWithRetry('t1', 'conv1', 'reason')).resolves.toBe(false);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('passes tenantId/conversationId/reason through to request() on both attempts', async () => {
    const service = buildService();
    const requestSpy = jest.spyOn(service, 'request').mockRejectedValue(new Error('down'));

    await service.requestWithRetry('t1', 'conv1', 'my reason');

    expect(requestSpy).toHaveBeenNthCalledWith(1, 't1', 'conv1', 'my reason');
    expect(requestSpy).toHaveBeenNthCalledWith(2, 't1', 'conv1', 'my reason');
  });
});
