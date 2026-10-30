import { AutomationTrigger } from '@prisma/client';

const VALID_TRIGGERS = new Set<string>(Object.values(AutomationTrigger));

/**
 * Maps an externally supplied trigger (API body, queue payload, stored value) to the Prisma enum.
 * Returns null for anything the database does not accept, so callers can reject or skip it
 * explicitly instead of letting Prisma throw "Invalid value for argument `trigger`".
 */
export function toAutomationTrigger(value: unknown): AutomationTrigger | null {
  return typeof value === 'string' && VALID_TRIGGERS.has(value) ? (value as AutomationTrigger) : null;
}
