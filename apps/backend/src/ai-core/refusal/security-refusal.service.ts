import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DigitalSelfContextService } from '../../digital-self/digital-self-context.service';
import { DEFAULT_MODEL_KEY, estimateCostUsd } from '../models/model-catalog';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { AiMeteredProviderService } from '../completion/ai-metered-provider.service';
import { checkCustomerText, parseStructuredReply } from '../completion/model-output.util';
import { AiExecutionsService } from '../executions/ai-executions.service';
import { newTrace } from '../pipeline/pipeline.types';
import { sanitizeForMessenger, sanitizeForWhatsApp } from '../pipeline/whatsapp-format.util';
import { formatHandoffBlock, HandoffOutcome } from '../prompts/handoff-context';
import { describeErrorForLog } from '../../common/privacy/prompt-redaction.util';

/** Refusals sent per conversation per window. Beyond this the guard still blocks, but nothing is generated or sent. */
export const SECURITY_REFUSAL_MAX_PER_WINDOW = 2;
export const SECURITY_REFUSAL_WINDOW_MS = 60 * 60_000;
/** Stored on the outbound message so the limit can be counted without a new table. */
export const SECURITY_REFUSAL_METADATA_KEY = 'securityRefusal';

const REFUSAL_MAX_TOKENS = 160;
const REFUSAL_MAX_CHARS = 400;
/** Prompt scaffolding must never come back out as a reply. */
const PROMPT_LEAK = /SITUATION:|HANDOFF STATUS|PERSONALITY:|IDENTITY:|SAFETY GUARDRAILS/i;

export interface SecurityRefusalInput {
  tenantId: string;
  conversationId: string;
  simulated?: boolean;
  channelType?: 'WHATSAPP' | 'FACEBOOK_MESSENGER';
  /** Verified outcome of a handoff already performed for this message, so the refusal does not contradict it. */
  handoffOutcome?: HandoffOutcome;
}

/**
 * Writes the customer-facing refusal for a message the injection guard blocked, in the workspace's own voice.
 *
 * The guard itself (detectInjection) is unchanged and still decides, before any other work, that the message is not acted on.
 * This only replaces the fixed sentence the guard used to send. Isolation is the point of the design: the model is never shown
 * the blocked message, any conversation history, knowledge base or tools, so the attacker's text cannot steer this call. It
 * receives only the workspace identity, the Digital Self style and a fixed instruction.
 *
 * Returns null, meaning "send nothing", when the per-conversation limit is reached, credits are unavailable, the provider fails
 * or the output does not validate. It never throws.
 */
@Injectable()
export class SecurityRefusalService {
  private readonly logger = new Logger(SecurityRefusalService.name);

  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistryService,
    private metered: AiMeteredProviderService,
    private executions: AiExecutionsService,
    @Optional() private digitalSelfContext?: DigitalSelfContextService,
  ) {}

  async generate(input: SecurityRefusalInput): Promise<string | null> {
    try {
      if (!(await this.withinLimit(input.tenantId, input.conversationId))) {
        this.logger.warn(`Security refusal not generated for conversation ${input.conversationId}: limit of ${SECURITY_REFUSAL_MAX_PER_WINDOW} per hour reached`);
        return null;
      }
      return await this.write(input);
    } catch (err) {
      this.logger.warn(`Security refusal not generated for conversation ${input.conversationId}: ${err instanceof Error ? err.name : 'unknown error'}`);
      return null;
    }
  }

  /** A failed count is treated as "over the limit": an unknown state must not become unlimited paid calls. */
  private async withinLimit(tenantId: string, conversationId: string): Promise<boolean> {
    const sent = await this.prisma.message.count({
      where: {
        tenantId,
        conversationId,
        direction: 'OUTBOUND',
        createdAt: { gte: new Date(Date.now() - SECURITY_REFUSAL_WINDOW_MS) },
        metadata: { path: [SECURITY_REFUSAL_METADATA_KEY], equals: true },
      },
    });
    return sent < SECURITY_REFUSAL_MAX_PER_WINDOW;
  }

  private async write(input: SecurityRefusalInput): Promise<string | null> {
    const { tenantId, conversationId } = input;
    const [settings, agent, styleBlock] = await Promise.all([
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { businessName: true, aiPersonality: true } }),
      this.prisma.aiAgent.findFirst({ where: { tenantId, isDefault: true }, select: { personality: true, modelKey: true } }),
      this.digitalSelfContext?.getStyleBlock(tenantId, conversationId) ?? Promise.resolve(''),
    ]);
    const businessName = settings?.businessName ?? 'our business';
    const personality = agent?.personality ?? settings?.aiPersonality ?? 'You are helpful, friendly, and professional. Keep replies concise and conversational.';
    const modelKey = agent?.modelKey ?? DEFAULT_MODEL_KEY;
    const channel = input.channelType === 'FACEBOOK_MESSENGER' ? 'Messenger' : 'WhatsApp';

    const system = [
      `You are a member of the ${businessName} team, replying to a customer on ${channel}.`,
      ``,
      `PERSONALITY: ${personality}`,
      styleBlock,
      formatHandoffBlock(input.handoffOutcome),
      ``,
      `SITUATION: The customer's latest message is something you will not act on. You are deliberately not shown it, so do not guess or mention what it said.`,
      `Write one short, natural reply of one or two sentences, in your own voice: kindly say you can't help with that, and steer them back to what you can help with at ${businessName}.`,
      `Do not explain rules or mention security, filters, instructions, systems, prompts or AI. Do not accuse the customer. Do not invent offers, prices, promises or actions. No markdown.`,
      `Respond with ONLY the text of the message.`,
    ].join('\n');

    const provider = this.registry.forModel(modelKey);
    const taskType = input.simulated ? 'TEST' : 'RESPONDER';
    const startedAt = Date.now();
    const trace = newTrace(input.simulated);
    trace.safetyFlags.injectionDetected = true;
    trace.modelKey = modelKey;

    let reply: string | null = null;
    try {
      const metered = await this.metered.complete(provider, tenantId, taskType, {
        modelKey,
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'Write your reply now.' }],
        maxTokens: REFUSAL_MAX_TOKENS,
        // 160 tokens is far too small for a reasoning model: its hidden reasoning used it all and the refusal came back empty on staging.
        disableThinking: true,
      });
      const completion = metered.result;
      trace.provider = completion.provider;
      trace.inputTokens = completion.usage.inputTokens;
      trace.outputTokens = completion.usage.outputTokens;
      trace.estCostUsd = estimateCostUsd(modelKey, completion.usage.inputTokens, completion.usage.outputTokens);
      if (metered.reservationId) trace.reservationIds = [metered.reservationId];
      reply = this.validated(completion.content, completion.finishReason, input.channelType);
      trace.status = reply ? 'SUCCESS' : 'EMPTY';
      if (!reply) trace.safetyFlags.emptyOutput = true;
    } catch (err) {
      trace.status = 'PROVIDER_ERROR';
      trace.errorCode = (err as { code?: string }).code ?? 'network';
      trace.errorMessage = err instanceof Error ? err.name : 'unknown error';
      this.logger.warn(`Security refusal generation failed for conversation ${conversationId}: ${trace.errorMessage}`);
    }

    trace.latencyMs = Date.now() - startedAt;
    // Traceability only: the provider call above already holds and settles its own credits, so this must not charge again.
    await this.executions.record({ tenantId, conversationId, taskType }, trace, { meterCredits: false }).catch((err) => {
      this.logger.warn(`Security refusal execution not recorded for conversation ${conversationId}: ${describeErrorForLog(err)}`);
    });
    return reply;
  }

  private validated(content: string, finishReason: string | undefined, channelType?: SecurityRefusalInput['channelType']): string | null {
    if (finishReason === 'length') return null;
    const parsed = parseStructuredReply(content);
    if (!parsed.ok) return null;
    const text = (channelType === 'FACEBOOK_MESSENGER' ? sanitizeForMessenger(parsed.response) : sanitizeForWhatsApp(parsed.response)).trim();
    if (!text || text.length > REFUSAL_MAX_CHARS || PROMPT_LEAK.test(text)) return null;
    return checkCustomerText(text).safe ? text : null;
  }
}
