/**
 * What the system verified about a customer's request for a person, handed to the model as a fact before it writes its reply.
 * The handoff is performed by messages.service.ts BEFORE generation, so the reply is written knowing whether it really happened
 * and never has to guess. This is an instruction to the model, never text sent to a customer.
 */
export type HandoffOutcome = 'requested' | 'failed';

export function formatHandoffBlock(outcome?: HandoffOutcome): string {
  if (outcome === 'requested') {
    return [
      ``,
      `HANDOFF STATUS (verified by the system, not by you):`,
      `- The customer has just asked to speak with a person. The conversation has been handed to the team and they have been notified.`,
      `- This is the one case where you may say the team has been notified: the system itself did it and verified it. It does not need a tool call from you.`,
      `- Acknowledge this naturally, in your own voice. Do NOT offer, suggest or ask whether they would like to speak with a person: it is already arranged, so offering it again would be confusing.`,
      `- Do not promise a time, a name or any specific action beyond what is stated here. Do not say someone is "on their way" or give a wait time.`,
      `- If their message also contains a question you can answer from what you know, answer it briefly; otherwise leave it for the team.`,
    ].join('\n');
  }
  if (outcome === 'failed') {
    return [
      ``,
      `HANDOFF STATUS (verified by the system, not by you):`,
      `- The customer has just asked to speak with a person, but the system could NOT reach the team right now.`,
      `- Do NOT say or imply that anyone has been notified, contacted, informed or is coming, and do not promise that anyone will follow up or call back.`,
      `- Be honest, in your own voice, that you could not arrange it just now, and carry on helping with what you can. Do not apologise at length.`,
    ].join('\n');
  }
  return '';
}
