import { EvaluationScenario } from '../evaluation.types';

/**
 * Verz-AI unification, Phase N-Q: scenarios covering the reasoning/confirmation/
 * delivery/escalation fixes from the second audit-and-improve pass -- the
 * "packaging glamour"-style real-world test conversations that exposed
 * over-eager escalation, no confirmation-word handling, and no delivery flow.
 * Run against the real CommerceAiService (never mocked), same isolation design
 * as commerce-eval-scenarios.ts.
 */
export const REASONING_EVAL_SCENARIOS: EvaluationScenario[] = [
  {
    key: 'reasoning_multi_item_order_no_premature_escalation',
    description: 'A clear multi-line order (two products x2, described in one message) must be parsed into real order lines, not escalated just because it needs several tool calls.',
    criteria: ['order_capture', 'escalation_behaviour'],
    products: { A: { type: 'any' }, B: { type: 'cheapest' } },
    turns: [
      {
        customerMessage: 'I need 2 of the {{product:A}} and 3 of the {{product:B}}, please add them both.',
        expectMustCallTools: ['add_item_to_order'],
        expectMustNotCallTools: ['create_internal_task'],
      },
    ],
  },
  {
    key: 'reasoning_bare_confirmation_after_proposal',
    description: 'After the AI proposes adding an item and the customer replies with a bare "okay", the AI must actually add it -- not escalate or ask again.',
    criteria: ['order_capture', 'escalation_behaviour'],
    products: { A: { type: 'any' } },
    turns: [
      { customerMessage: 'Can I get 2 of the {{product:A}}? Add it if that works.' },
      { customerMessage: 'okay', expectMustCallTools: ['add_item_to_order'] },
    ],
  },
  {
    key: 'reasoning_advice_request_not_escalated',
    description: 'A request for advice/recommendation ("which one should I use") must be reasoned from real product data, never handed off just because it requires judgement.',
    criteria: ['escalation_behaviour', 'response_quality'],
    products: { A: { type: 'cheapest' }, B: { type: 'mostExpensive' } },
    turns: [
      {
        customerMessage: 'Can you please advise -- I need something for a big order, which of the {{product:A}} or {{product:B}} would work better for that?',
        expectMustNotCallTools: ['create_internal_task'],
      },
    ],
  },
  {
    key: 'reasoning_delivery_location_flow',
    description: 'Asking about delivery, then giving a location, must be handled as a real conversation flow (check_delivery_info, ask for/accept the location) -- never a generic "I\'ve flagged it" handoff.',
    criteria: ['escalation_behaviour', 'response_quality'],
    products: {},
    turns: [
      { customerMessage: 'Can this be delivered to me?', expectMustCallTools: ['check_delivery_info'], expectMustNotCallTools: ['create_internal_task'] },
      { customerMessage: 'Kasoa', expectMustNotCallTools: ['create_internal_task'] },
    ],
  },
  {
    key: 'reasoning_provider_failure_never_silent',
    description: 'Sanity check that a scripted scenario always gets SOME customer-facing response -- the harness itself would surface a blank/missing response as a scoring failure if the silent-failure bug ever regressed.',
    criteria: ['response_quality'],
    products: { A: { type: 'any' } },
    turns: [{ customerMessage: 'How much is the {{product:A}}?' }],
  },
];
