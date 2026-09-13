import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FailureCategory } from '@prisma/client';
import { DEEPSEEK_API_URL, DEEPSEEK_MODEL } from '../common/deepseek';
import { ResolvedInteractionContext } from './interaction-context.resolver';
import { DimensionScores, computeOverallScore, computeSeverity, needsHumanReview } from './dimension-scoring.util';

const VALID_CATEGORIES = new Set<string>(Object.values(FailureCategory));
const VALID_DIMENSION_KEYS = new Set([
  'contextUnderstanding', 'accuracy', 'naturalness', 'intentHandling', 'commerceReasoning',
  'toolSelection', 'toolExecution', 'handoffQuality', 'conversationContinuity', 'responseAppropriateness',
]);

export interface EvaluationResult {
  dimensions: DimensionScores;
  overallScore: number | null;
  failureCategories: FailureCategory[];
  severity: ReturnType<typeof computeSeverity>;
  reasoning: string;
  confidence: number;
  needsHumanReview: boolean;
  falseActionClaim: boolean;
  falseSuccessClaim: boolean;
  unnecessaryHandoff: boolean;
  customerCorrectionDetected: boolean;
}

const SYSTEM_PROMPT = `You are grading one turn of a WhatsApp customer-service AI agent ("Verz") for a business, against real backend state supplied to you. Score honestly -- this grading data drives real product decisions.

Score each APPLICABLE dimension 0-5 (omit a dimension entirely from the JSON if it does not apply to this turn -- e.g. omit commerceReasoning if no product/order/price was discussed, omit toolSelection/toolExecution if no tools were available to call, omit handoffQuality if no handoff was needed):
- contextUnderstanding: did it correctly understand what the customer was asking, including prior context?
- accuracy: was the response factually/business-wise correct?
- naturalness: does it read like a competent human employee, not a chatbot? Penalize robotic phrasing, "as an AI", excessive disclaimers, unnecessary bullet points, generic support language.
- intentHandling: did it correctly identify the customer's intent(s), including when there were multiple?
- commerceReasoning: correct product/size/colour/quantity/price/order-state/payment-state reasoning (omit if not applicable).
- toolSelection: did it call the right tool(s), or correctly avoid calling one it didn't need? (omit if no tools were available)
- toolExecution: did the tool call(s) actually succeed and get used correctly? (omit if no tools were called)
- handoffQuality: if a handoff happened or should have, was it actually necessary and honestly communicated? (omit if no handoff signal at all)
- conversationContinuity: did it preserve relevant context across turns without losing track?
- responseAppropriateness: did it ask only necessary questions, avoid repeating known info, avoid over-escalating, correctly distinguish a future intent ("I'll order next month") from an immediate one, handle topic switches correctly?

CRITICAL: you are given real backend state (latestOrderStatus, handoffTaskExists). Flag falseActionClaim/falseSuccessClaim ONLY if the response claims something happened (payment received, order placed, delivery arranged, team notified, escalated) that the real backend state contradicts. A vague "let me check" or "I'll get someone to help" is NOT a false claim by itself -- only flag it if handoffTaskExists is false AND the response asserts the handoff already happened (not just that it will).

Return ONLY valid JSON, no markdown, in exactly this shape:
{"dimensions": {"<applicable dimension keys only>": <0-5 number>}, "failureCategories": ["<subset of the fixed taxonomy given>"], "reasoning": "<one or two sentences>", "confidence": <0-1>, "falseActionClaim": true|false, "falseSuccessClaim": true|false, "unnecessaryHandoff": true|false, "customerCorrectionDetected": true|false}

Valid failureCategories values (use ONLY these, omit the field or use [] if none apply):
${Array.from(VALID_CATEGORIES).join(', ')}`;

@Injectable()
export class AiInteractionEvaluatorService {
  private readonly logger = new Logger(AiInteractionEvaluatorService.name);

  async evaluate(ctx: ResolvedInteractionContext): Promise<EvaluationResult | null> {
    const userContent = JSON.stringify({
      priorContext: ctx.priorContext.map((m) => ({ from: m.direction === 'INBOUND' ? 'customer' : 'agent', text: m.content })),
      customerMessage: ctx.customerMessage,
      aiResponse: ctx.aiResponse,
      realBackendState: {
        latestOrderStatus: ctx.latestOrderStatus,
        handoffTaskExists: ctx.handoffTaskExists,
        conversationStatus: ctx.conversationStatus,
      },
    });

    const raw = await this.callJudge(userContent);
    if (!raw) return null;

    const parsed = this.validateAndNormalize(raw);
    if (!parsed) return null;

    const overallScore = computeOverallScore(parsed.dimensions);
    const severity = computeSeverity(parsed.failureCategories);
    const review = needsHumanReview({
      overallScore,
      severity,
      falseActionClaim: parsed.falseActionClaim,
      falseSuccessClaim: parsed.falseSuccessClaim,
      unnecessaryHandoff: parsed.unnecessaryHandoff,
      customerCorrectionDetected: parsed.customerCorrectionDetected,
      evaluatorConfidence: parsed.confidence,
    });

    return {
      dimensions: parsed.dimensions,
      overallScore,
      failureCategories: parsed.failureCategories,
      severity,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      needsHumanReview: review,
      falseActionClaim: parsed.falseActionClaim,
      falseSuccessClaim: parsed.falseSuccessClaim,
      unnecessaryHandoff: parsed.unnecessaryHandoff,
      customerCorrectionDetected: parsed.customerCorrectionDetected,
    };
  }

  private async callJudge(userContent: string): Promise<string | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await axios.post(
          DEEPSEEK_API_URL,
          {
            model: DEEPSEEK_MODEL,
            max_tokens: 500,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
            response_format: { type: 'json_object' },
          },
          { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20_000 },
        );
        const content = (res.data?.choices?.[0]?.message?.content as string | undefined)?.trim();
        if (content) return content;
      } catch (err) {
        this.logger.warn(`Evaluator judge call failed (attempt ${attempt + 1}): ${String(err)}`);
      }
    }
    return null;
  }

  /** Never trust raw model output -- validates shape, clamps scores into
   * [0,5], drops any dimension key or failure category the model
   * hallucinated outside the fixed taxonomy, rather than persisting it. */
  private validateAndNormalize(raw: string): {
    dimensions: DimensionScores;
    failureCategories: FailureCategory[];
    reasoning: string;
    confidence: number;
    falseActionClaim: boolean;
    falseSuccessClaim: boolean;
    unnecessaryHandoff: boolean;
    customerCorrectionDetected: boolean;
  } | null {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (typeof obj !== 'object' || obj === null) return null;

    const rawDimensions = obj['dimensions'];
    const dimensions: DimensionScores = {};
    if (rawDimensions && typeof rawDimensions === 'object') {
      for (const [key, value] of Object.entries(rawDimensions as Record<string, unknown>)) {
        if (!VALID_DIMENSION_KEYS.has(key)) continue;
        if (typeof value !== 'number' || Number.isNaN(value)) continue;
        (dimensions as Record<string, number>)[key] = Math.min(5, Math.max(0, value));
      }
    }
    if (Object.keys(dimensions).length === 0) return null;

    const rawCategories = obj['failureCategories'];
    const failureCategories: FailureCategory[] = Array.isArray(rawCategories)
      ? rawCategories.filter((c): c is FailureCategory => typeof c === 'string' && VALID_CATEGORIES.has(c))
      : [];

    const confidence = typeof obj['confidence'] === 'number' ? Math.min(1, Math.max(0, obj['confidence'] as number)) : 0.5;
    const reasoning = typeof obj['reasoning'] === 'string' ? (obj['reasoning'] as string).slice(0, 1000) : '';

    return {
      dimensions,
      failureCategories,
      reasoning,
      confidence,
      falseActionClaim: obj['falseActionClaim'] === true,
      falseSuccessClaim: obj['falseSuccessClaim'] === true,
      unnecessaryHandoff: obj['unnecessaryHandoff'] === true,
      customerCorrectionDetected: obj['customerCorrectionDetected'] === true,
    };
  }
}
