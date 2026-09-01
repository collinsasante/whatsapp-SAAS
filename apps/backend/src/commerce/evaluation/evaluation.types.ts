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
  | 'response_quality';

export interface ScenarioTurn {
  /** May reference {{product:A}} placeholders, resolved from the scenario's `products` map. */
  customerMessage: string;
  expectMustCallTools?: string[];
  expectMustNotCallTools?: string[];
}

export interface EvaluationScenario {
  key: string;
  description: string;
  criteria: EvalCriterion[];
  products: Record<string, ProductSelector>;
  /** Default true -- if a selector can't resolve against the tenant's real catalogue,
   * the case is recorded SKIPPED, never silently passed or failed. */
  skipIfUnresolvable?: boolean;
  turns: ScenarioTurn[];
  fixtures?: { simulatePriorPaidOrder?: boolean };
}
