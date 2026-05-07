import { AutomationTrigger, AutomationAction } from './enums';

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'matches';
  value: string;
}

export interface AutomationActionConfig {
  type: AutomationAction;
  payload: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationActionConfig[];
  priority: number;
  executionCount: number;
  createdAt: Date;
  updatedAt: Date;
}
