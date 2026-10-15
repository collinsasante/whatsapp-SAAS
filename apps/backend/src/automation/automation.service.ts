import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAutomationRuleDto, UpdateAutomationRuleDto } from './dto/automation.dto';
import { AutomationCondition, AutomationActionConfig } from '@whatsapp-platform/shared-types';
import { toAutomationTrigger } from './automation-trigger';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(private prisma: PrismaService) {}

  private requireTrigger(value: unknown) {
    const trigger = toAutomationTrigger(value);
    if (!trigger) throw new BadRequestException(`Unsupported automation trigger: ${String(value)}`);
    return trigger;
  }

  async create(tenantId: string, dto: CreateAutomationRuleDto) {
    return this.prisma.automationRule.create({
      data: {
        tenantId,
        name: dto.name,
        trigger: this.requireTrigger(dto.trigger),
        conditions: dto.conditions as never,
        actions: dto.actions as never,
        priority: dto.priority ?? 0,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Automation rule not found');
    return rule;
  }

  async update(tenantId: string, id: string, dto: UpdateAutomationRuleDto) {
    await this.findOne(tenantId, id);
    return this.prisma.automationRule.update({ where: { id }, data: dto as never });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.automationRule.delete({ where: { id } });
  }

  async findMatchingRules(tenantId: string, triggerValue: string, context: Record<string, unknown>) {
    const trigger = toAutomationTrigger(triggerValue);
    if (!trigger) {
      this.logger.warn(`Ignoring unsupported automation trigger "${triggerValue}" for tenant ${tenantId}`);
      return [];
    }
    const rules = await this.prisma.automationRule.findMany({
      where: { tenantId, trigger, isActive: true },
      orderBy: { priority: 'desc' },
    });

    return rules.filter((rule) => {
      const conditions = rule.conditions as unknown as AutomationCondition[];
      if (!conditions.length) return true;

      return conditions.every((condition) => {
        const value = context[condition.field] as string;
        if (!value) return false;

        switch (condition.operator) {
          case 'equals': return value.toLowerCase() === condition.value.toLowerCase();
          case 'contains': return value.toLowerCase().includes(condition.value.toLowerCase());
          case 'starts_with': return value.toLowerCase().startsWith(condition.value.toLowerCase());
          case 'ends_with': return value.toLowerCase().endsWith(condition.value.toLowerCase());
          case 'matches': return new RegExp(condition.value, 'i').test(value);
          default: return false;
        }
      });
    });
  }

  async executeRule(tenantId: string, ruleId: string, context: Record<string, unknown>) {
    const rule = await this.findOne(tenantId, ruleId);
    const actions = rule.actions as unknown as AutomationActionConfig[];

    await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { executionCount: { increment: 1 } },
    });

    return actions;
  }
}
