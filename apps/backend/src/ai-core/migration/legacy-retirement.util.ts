/**
 * Decides, per workspace, whether it can move from the legacy responder to VerzAI v2 without losing anything it has today.
 * Pure: it reads plain data and returns a verdict, so the rules are testable and the script that gathers the data stays thin.
 *
 * Nothing here switches a workspace over. The switch is the existing `verz_ai_v2` feature flag (a per-workspace rollout row),
 * turned on deliberately by a platform admin for workspaces this assessment says are ready. The only change the script may make
 * itself is the one "safe action" below, which fills a gap and never overwrites anything.
 */

export type ChatRoute = 'commerce' | 'v2' | 'legacy';

export interface RetirementInput {
  tenantId: string;
  commerceEnabled: boolean;
  /** The verz_ai_v2 flag as evaluated for this workspace today. */
  v2FlagEnabled: boolean;
  aiEnabled: boolean;
  aiMode: string | null;
  /** TenantSettings.aiPersonality: what the legacy responder reads. */
  settingsPersonality: string | null;
  /** The workspace's default AI agent, which v2 reads. Null until the first v2 turn creates it lazily. */
  agent: { status: string; personality: string | null; modelKey: string; maxResponseTokens: number } | null;
  /** The globally active responder.system prompt. */
  activePrompt: { version: string; scriptsFixedReply: boolean } | null;
  currentPromptVersion: string;
  /** Active knowledge-base articles. The legacy responder and v2 both answer from these, so a count of 0 is not a regression. */
  knowledgeArticles: number;
}

export type SafeAction = { type: 'fill_agent_personality'; agentPersonality: string };

export interface RetirementAssessment {
  tenantId: string;
  route: ChatRoute;
  /** True when nothing blocks moving this workspace to v2. A Commerce workspace has nothing to move. */
  ready: boolean;
  blockers: string[];
  warnings: string[];
  safeActions: SafeAction[];
}

/** The legacy responder's output limit; v2 takes the agent's, so a lower value would cut replies the legacy path would have sent. */
const LEGACY_MAX_TOKENS = 400;

export function assessLegacyRetirement(input: RetirementInput): RetirementAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const safeActions: SafeAction[] = [];

  if (input.commerceEnabled) {
    // Commerce keeps its own generator and its commerce tools; the legacy responder is never involved for it.
    return { tenantId: input.tenantId, route: 'commerce', ready: true, blockers, warnings: ['Commerce workspace: keeps CommerceAiService; nothing to migrate'], safeActions };
  }

  const route: ChatRoute = input.v2FlagEnabled ? 'v2' : 'legacy';

  if (!input.activePrompt) {
    blockers.push('No ACTIVE responder.system prompt exists yet');
  } else if (input.activePrompt.version !== input.currentPromptVersion) {
    blockers.push(`The active prompt is v${input.activePrompt.version}, not v${input.currentPromptVersion}; deploy the current release (it upgrades an untouched prompt) or have a SUPER_ADMIN activate the current version first`);
  } else if (input.activePrompt.scriptsFixedReply) {
    blockers.push('The active prompt scripts a fixed customer reply');
  }

  if (input.agent) {
    if (input.agent.status !== 'ACTIVE') blockers.push(`The default AI agent is ${input.agent.status}; v2 would not answer as the legacy responder does`);
    if (input.agent.maxResponseTokens < LEGACY_MAX_TOKENS) warnings.push(`The default agent limits replies to ${input.agent.maxResponseTokens} tokens (legacy: ${LEGACY_MAX_TOKENS}); longer replies would be cut off and handed to a person`);

    const wanted = input.settingsPersonality?.trim() ? input.settingsPersonality : null;
    const has = input.agent.personality?.trim() ? input.agent.personality : null;
    if (wanted && has && wanted !== has) {
      blockers.push('The workspace personality and the default agent personality are both set and differ: decide which one customers should hear, then make them match (neither is overwritten automatically)');
    } else if (wanted && !has) {
      safeActions.push({ type: 'fill_agent_personality', agentPersonality: wanted });
    }
  } else {
    warnings.push('No default AI agent yet: it is created automatically, from the workspace personality, on the first v2 turn');
  }

  if (!input.aiEnabled) warnings.push('AI is switched off for this workspace; the migration changes nothing until it is switched on');
  if (input.knowledgeArticles === 0) warnings.push('The knowledge base has no active articles (the same answer source for legacy and v2)');

  return { tenantId: input.tenantId, route, ready: blockers.length === 0, blockers, warnings, safeActions };
}
