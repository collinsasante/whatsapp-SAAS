import type { MetricDefinition } from '@/lib/analytics/metrics';

/** Definitions shown beside each dashboard number. They match the Analytics page, which uses the same queries. */
export const DASHBOARD_METRICS = {
  conversations: {
    label: 'Conversations',
    meaning: 'How many customer conversations were opened.',
    calculation: 'Conversations created in the period. Evaluation and test conversations are excluded.',
    kind: 'measured', direction: 'neutral',
  },
  newCustomers: {
    label: 'New customers',
    meaning: 'People who reached you for the first time.',
    calculation: 'Contacts created in the period. Evaluation contacts are excluded.',
    kind: 'measured', direction: 'higher-is-better',
  },
  firstReply: {
    label: 'Median first response',
    meaning: 'How long a typical customer waits for the first answer.',
    calculation: 'For conversations opened in the period that got a reply: time from the customer\'s first message to the first message sent back by a person or Verz AI. A message that failed to send does not count as a reply. The median is the middle value, so one very slow conversation cannot distort it.',
    kind: 'operational', direction: 'lower-is-better',
  },
  resolutionRate: {
    label: 'Resolution rate',
    meaning: 'Of the conversations that started in the period, how many are resolved now.',
    calculation: 'Conversations opened in the period that are currently resolved, divided by all conversations opened in the period. It includes conversations resolved after the period ended, so an older period has had longer to reach a high rate.',
    kind: 'measured', direction: 'higher-is-better',
  },
  messages: {
    label: 'Customer messages',
    meaning: 'How much customers are writing to you, and how much you send back.',
    calculation: 'Messages received from customers in the period, and messages sent by your team, Verz AI and automations. Messages that failed to send are not counted as sent.',
    kind: 'measured', direction: 'neutral',
  },
  outcomes: {
    label: 'Business outcomes',
    meaning: 'Money and leads that came from conversations.',
    calculation: 'Orders paid in the period, summed per currency (currencies are never added together), and leads scored as qualified. Sales made outside VerzChat are not included.',
    kind: 'attributed', direction: 'higher-is-better',
  },
} satisfies Record<string, MetricDefinition>;
