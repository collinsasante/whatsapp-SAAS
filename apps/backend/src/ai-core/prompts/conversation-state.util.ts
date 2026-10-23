import { AiState } from '../tools/state-derivation.util';

/**
 * Verz-AI unification, Phase F: renders aiState as a compact "what you already
 * know" block, omitted entirely when empty so a brand-new conversation doesn't
 * pay for it. This is advisory text the model reads, same category as the
 * knowledge-base block -- nothing in the pipeline branches on these values, so
 * a stale entry is a context-quality problem, not a broken-state-machine one.
 */
export function formatStateBlock(state: AiState | null | undefined): string {
  if (!state) return '';
  const lines: string[] = [];

  if (state.currentIntent) lines.push(`Current goal: ${state.currentIntent}`);
  if (state.lastTopic) lines.push(`Last topic before any tangent: ${state.lastTopic}`);
  if (state.selectedProductId) lines.push(`Product currently being discussed: ${state.selectedProductId}`);
  if (state.activeOrderId) lines.push(`Active draft order: ${state.activeOrderId}`);
  if (state.knownFacts && Object.keys(state.knownFacts).length > 0) {
    lines.push(...Object.entries(state.knownFacts).map(([k, v]) => `${k}: ${v}`));
  }
  if (state.missingInfo && state.missingInfo.length > 0) {
    lines.push(`Still need from the customer: ${state.missingInfo.join(', ')}`);
  }

  if (lines.length === 0) return '';
  return `\n\nWHAT YOU ALREADY KNOW ABOUT THIS CONVERSATION (don't ask again for anything listed here; use it to resume a task after answering a tangent):\n${lines.join('\n')}`;
}
