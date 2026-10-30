import type { Direction } from './format';

/**
 * Where a number comes from, so nobody mistakes one kind for another:
 *  - measured: counted directly from records VerzChat holds
 *  - attributed: counted from records, but linked to a conversation by VerzChat
 *  - operational: describes the work of the team or Verz AI, not a business outcome
 */
export type MetricKind = 'measured' | 'attributed' | 'operational';

export interface MetricDefinition {
  label: string;
  /** What the number means, in plain words. */
  meaning: string;
  /** Exactly how it is calculated, including what is excluded. */
  calculation: string;
  kind: MetricKind;
  direction: Direction;
}

export const KIND_LABEL: Record<MetricKind, string> = {
  measured: 'Measured',
  attributed: 'Attributed',
  operational: 'Operational',
};

export const METRICS = {
  conversations: {
    label: 'Conversations',
    meaning: 'How many customer conversations were opened.',
    calculation: 'Conversations created in the period. Evaluation and test conversations are excluded.',
    kind: 'measured', direction: 'neutral',
  },
  newContacts: {
    label: 'New contacts',
    meaning: 'People who reached you for the first time.',
    calculation: 'Contacts created in the period. With a channel selected, only contacts who have a conversation on that channel.',
    kind: 'measured', direction: 'higher-is-better',
  },
  firstReply: {
    label: 'Median first reply',
    meaning: 'How long a typical customer waits for the first answer.',
    calculation: 'For conversations opened in the period that got a reply: time from the customer\'s first message to the first message you or Verz AI sent back. The median is the middle value, so one very slow conversation cannot distort it.',
    kind: 'operational', direction: 'lower-is-better',
  },
  resolved: {
    label: 'Resolved',
    meaning: 'How many conversations were closed as resolved.',
    calculation: 'Conversations whose resolved time falls in the period, whenever they were opened.',
    kind: 'measured', direction: 'higher-is-better',
  },
  openNow: {
    label: 'Open now',
    meaning: 'Conversations that still need work today.',
    calculation: 'A snapshot of right now, not the selected period: conversations that are not resolved or snoozed. It has no previous-period comparison.',
    kind: 'operational', direction: 'lower-is-better',
  },
  resolution: {
    label: 'Median time to resolve',
    meaning: 'How long conversations take to finish.',
    calculation: 'For conversations resolved in the period: time from creation to resolution, median.',
    kind: 'operational', direction: 'lower-is-better',
  },
  sla: {
    label: 'Response targets met',
    meaning: 'How often a response deadline was kept.',
    calculation: 'Of conversations opened in the period that had a response deadline, the share that did not breach it. Unavailable when no deadlines were set.',
    kind: 'operational', direction: 'higher-is-better',
  },
  csat: {
    label: 'Customer satisfaction',
    meaning: 'The average rating customers gave, out of 5.',
    calculation: 'Average of ratings submitted in the period. Unavailable until customers have rated conversations.',
    kind: 'measured', direction: 'higher-is-better',
  },
  leads: {
    label: 'Leads',
    meaning: 'Conversations scored as sales leads.',
    calculation: 'Leads created in the period. Leads are scored automatically from the conversation, so treat the status as an assessment, not a fact.',
    kind: 'attributed', direction: 'higher-is-better',
  },
  qualified: {
    label: 'Qualified leads',
    meaning: 'Leads judged to be real prospects.',
    calculation: 'Of leads created in the period, those whose status is Qualified, Warm, Hot or Converted.',
    kind: 'attributed', direction: 'higher-is-better',
  },
  revenue: {
    label: 'Order revenue',
    meaning: 'Money from orders customers have paid for.',
    calculation: 'Orders created in Commerce, paid in the period, and not cancelled or refunded, summed per currency. Currencies are never added together. Sales made outside VerzChat are not included.',
    kind: 'measured', direction: 'higher-is-better',
  },
  orderConversion: {
    label: 'Conversations that led to an order',
    meaning: 'How many conversations ended with a paid order.',
    calculation: 'Of conversations opened in the period, the share that have at least one paid order linked to them (now or later). Orders not linked to a conversation are not counted.',
    kind: 'attributed', direction: 'higher-is-better',
  },
  aiEngaged: {
    label: 'Conversations with Verz AI',
    meaning: 'Conversations where Verz AI wrote a reply or a suggestion.',
    calculation: 'Distinct conversations with a Verz AI suggestion or automatic reply logged in the period.',
    kind: 'operational', direction: 'neutral',
  },
  aiHandoff: {
    label: 'Passed to a person',
    meaning: 'How often Verz AI conversations needed a person.',
    calculation: 'Of conversations Verz AI took part in during the period, the share where the customer asked for a person or an agent took over afterwards.',
    kind: 'operational', direction: 'lower-is-better',
  },
  aiResolved: {
    label: 'Resolved without a person',
    meaning: 'Conversations Verz AI finished on its own.',
    calculation: 'Conversations resolved in the period that had an automatic Verz AI reply and no message from a person. A conversation is not counted just because Verz AI sent a message.',
    kind: 'operational', direction: 'higher-is-better',
  },
} satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;
