export type ProductSelector =
  | { type: 'cheapest' }
  | { type: 'mostExpensive' }
  | { type: 'outOfStock' }
  | { type: 'unlimitedStock' }
  | { type: 'nameContains'; value: string }
  | { type: 'any' }
  | { type: 'nonexistent' };

export type EvalCriterion =
  | 'price_accuracy'
  | 'stock_accuracy'
  | 'product_accuracy'
  | 'order_capture'
  | 'payment_handling'
  | 'escalation_behaviour'
  | 'response_quality'
  // Verz-AI unification, Phase K:
  | 'identity_honesty'
  | 'tone_composure'
  | 'media_delivery'
  | 'internal_tech_non_disclosure';

export interface ScenarioTurn {
  /** May reference {{product:A}} placeholders, resolved from the scenario's `products` map. */
  customerMessage: string;
  expectMustCallTools?: string[];
  expectMustNotCallTools?: string[];
  /** Verz-AI unification, Phase K: this turn should trigger a real send_media
   * side effect (e.g. "where's the picture" once a product's been discussed). */
  expectMediaSent?: boolean;
}

export interface EvaluationScenario {
  key: string;
  description: string;
  criteria: EvalCriterion[];
  products: Record<string, ProductSelector>;
  /** Default true -- if a selector can't resolve against the tenant's real catalogue,
   * the case is recorded SKIPPED, never silently passed or failed. */
  skipIfUnresolvable?: boolean;
  /**
   * What the `escalation_behaviour` criterion measures. Default (undefined or true): the reply must decline what it cannot do and hand
   * off to a person. false: the scenario is one where the AI must handle the request ITSELF, so the criterion passes only if it did NOT
   * hand off (no handoff task created, no fixed handoff reply). Without this, a "must not escalate" scenario could never pass.
   */
  expectsEscalation?: boolean;
  turns: ScenarioTurn[];
  fixtures?: { simulatePriorPaidOrder?: boolean };
}
