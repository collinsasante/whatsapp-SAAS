/** What the AI will do with the next customer message after a conversation is returned to it. */
export interface AiHandling {
  mode: 'SUGGESTION' | 'AUTO_REPLY' | null;
  willAutoReply: boolean;
  reason: 'AI_DISABLED' | 'TRIAL_NOT_APPROVED' | 'NO_CREDITS' | 'OUTSIDE_SCHEDULE' | null;
}

export function describeAiHandling(h: AiHandling | null | undefined): { level: 'success' | 'info' | 'warning'; text: string } {
  const base = 'Returned to Verz AI.';
  if (!h) return { level: 'info', text: base };
  if (h.willAutoReply) return { level: 'success', text: `${base} It will reply to new messages.` };
  switch (h.reason) {
    case 'AI_DISABLED':
      return { level: 'warning', text: `${base} AI is switched off for this workspace, so nobody will reply until it is turned on.` };
    case 'TRIAL_NOT_APPROVED':
      return { level: 'warning', text: `${base} AI is not approved for this workspace yet, so it will not reply.` };
    case 'NO_CREDITS':
      return { level: 'warning', text: `${base} There are no AI credits left, so it will not reply until you top up.` };
    case 'OUTSIDE_SCHEDULE':
      return { level: 'warning', text: `${base} Auto-reply only runs outside your configured hours, so your team needs to reply until then.` };
    default:
      break;
  }
  if (h.mode === 'SUGGESTION') {
    return { level: 'info', text: `${base} It is in suggestion mode, so it drafts replies for your team to review and does not send them.` };
  }
  return { level: 'info', text: base };
}
