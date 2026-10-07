import { AutomationTrigger as PrismaAutomationTrigger } from '@prisma/client';
import { AutomationTrigger } from '@whatsapp-platform/shared-types';
import { BadRequestException } from '@nestjs/common';
import { toAutomationTrigger } from './automation-trigger';
import { AutomationService } from './automation.service';

describe('AutomationTrigger', () => {
  it('shared-types enum and database enum list exactly the same triggers', () => {
    // INACTIVITY existed only in shared-types, so the worker's Prisma query failed every run.
    expect(new Set(Object.values(AutomationTrigger))).toEqual(new Set(Object.values(PrismaAutomationTrigger)));
  });

  it.each(Object.values(PrismaAutomationTrigger))('accepts %s', (value) => {
    expect(toAutomationTrigger(value)).toBe(value);
  });

  it.each([undefined, null, '', 'inactivity', 'Inactivity', 'message_received', 42, {}])('rejects %p', (value) => {
    expect(toAutomationTrigger(value)).toBeNull();
  });
});

describe('AutomationService trigger handling', () => {
  const prisma = {
    automationRule: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'r1' }),
    },
  };
  const service = new AutomationService(prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it('creates an INACTIVITY rule with the database enum value', async () => {
    await service.create('t1', { name: 'Nudge', trigger: AutomationTrigger.INACTIVITY, conditions: [], actions: [] } as never);
    expect(prisma.automationRule.create.mock.calls[0][0].data.trigger).toBe(PrismaAutomationTrigger.INACTIVITY);
  });

  it('rejects an unknown or missing trigger before reaching Prisma', async () => {
    await expect(service.create('t1', { name: 'x', trigger: 'message_received', conditions: [], actions: [] } as never)).rejects.toThrow(BadRequestException);
    await expect(service.create('t1', { name: 'x', conditions: [], actions: [] } as never)).rejects.toThrow(BadRequestException);
    expect(prisma.automationRule.create).not.toHaveBeenCalled();
  });

  it('findMatchingRules skips unknown triggers instead of throwing', async () => {
    await expect(service.findMatchingRules('t1', 'not_a_trigger', {})).resolves.toEqual([]);
    expect(prisma.automationRule.findMany).not.toHaveBeenCalled();
    await service.findMatchingRules('t1', 'KEYWORD', {});
    expect(prisma.automationRule.findMany.mock.calls[0][0].where.trigger).toBe('KEYWORD');
  });
});
