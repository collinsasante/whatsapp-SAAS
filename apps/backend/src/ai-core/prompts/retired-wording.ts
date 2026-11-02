/**
 * Wording that earlier prompt versions scripted for the model to say to customers verbatim. A stored prompt that still
 * contains any of it must never be served: the model would recite it instead of writing its own reply.
 * Detection only; these patterns are never sent to a customer.
 */
export const RETIRED_SCRIPTED_REPLY_PATTERNS: readonly RegExp[] = [
  /that'?s a great question[!.]?\s*our team will follow up/i,
  /team will follow up with you shortly/i,
  /respond ONLY with:/i,
];

export function containsRetiredScript(body: string): boolean {
  return RETIRED_SCRIPTED_REPLY_PATTERNS.some((pattern) => pattern.test(body));
}
