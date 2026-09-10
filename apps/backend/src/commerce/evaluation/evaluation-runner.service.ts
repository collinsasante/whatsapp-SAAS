import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CommerceAiService } from '../ai/commerce-ai.service';
import { EvaluationScoringService, EvalTurnRecord, ResolvedProductRef } from './evaluation-scoring.service';
import { EvaluationScenario, ProductSelector } from './evaluation.types';
import { EvaluationCaseStatus } from '@prisma/client';

const NONEXISTENT_PRODUCT_NAME = 'Titanium Deluxe Widget Pro';

export interface RunScenarioResult {
  status: EvaluationCaseStatus;
  contactId?: string;
  conversationId?: string;
  orderId?: string;
  transcript: unknown;
  scores: Record<string, unknown>;
  failureReasons: string[];
  criticalFailure: boolean;
}

/** Drives one scenario end-to-end against the real CommerceAiService --
 * never mocked. See evaluation.types.ts for the scenario shape and the
 * implementation plan for the full isolation-from-real-data design. */
@Injectable()
export class EvaluationRunnerService {
  private readonly logger = new Logger(EvaluationRunnerService.name);

  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private commerceAi: CommerceAiService,
    private scoring: EvaluationScoringService,
  ) {}

  async runScenario(tenantId: string, scenario: EvaluationScenario): Promise<RunScenarioResult> {
    const catalogue = await this.products.findAll(tenantId, true);

    const resolved: ResolvedProductRef[] = [];
    for (const [slot, selector] of Object.entries(scenario.products)) {
      const ref = this.resolveSelector(slot, selector, catalogue);
      if (!ref && (scenario.skipIfUnresolvable ?? true) && selector.type !== 'nonexistent') {
        return {
          status: EvaluationCaseStatus.SKIPPED,
          transcript: [],
          scores: {},
          failureReasons: [`Could not resolve product selector "${slot}" (${selector.type}) against this tenant's catalogue`],
          criticalFailure: false,
        };
      }
      if (ref) resolved.push(ref);
    }

    // Real, isolated Contact + Conversation -- tagged so eval data never
    // masquerades as a real customer in the inbox/analytics/reconciliation.
    const evalPhone = `+000EVAL${crypto.randomBytes(6).toString('hex')}`;
    const contact = await this.prisma.contact.create({
      data: { tenantId, phone: evalPhone, name: `Eval: ${scenario.key}`, isEvalContact: true },
    });
    const conversation = await this.prisma.conversation.create({
      data: { tenantId, contactId: contact.id, contactSource: 'eval_harness', status: 'RESOLVED' },
    });

    let orderId: string | undefined;
    if (scenario.fixtures?.simulatePriorPaidOrder) {
      const productForFixture = resolved[0];
      const totalMajorUnits = productForFixture ? catalogue.find((p) => p.id === productForFixture.id)?.priceMajorUnits ?? 10 : 10;
      // Privileged runner-only write, deliberately bypassing CommerceLedgerService.recordPaymentSuccess
      // -- creates zero CommerceLedgerEntry rows, no GMV/take-rate contamination. This constructs a
      // world-state to observe AI behavior in; it grants the AI no new capability whatsoever.
      const order = await this.prisma.order.create({
        data: {
          tenantId, contactId: contact.id, conversationId: conversation.id,
          customerPhone: evalPhone, status: 'PAID', paidAt: new Date(),
          subtotalMajorUnits: totalMajorUnits, totalMajorUnits,
          paystackReference: `EVAL-${crypto.randomUUID()}`, isEvalOrder: true,
        },
      });
      orderId = order.id;
    }

    const turns: EvalTurnRecord[] = [];
    for (const scriptedTurn of scenario.turns) {
      const customerMessage = this.fillPlaceholders(scriptedTurn.customerMessage, resolved);

      await this.prisma.message.create({
        data: { tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', type: 'TEXT', status: 'DELIVERED', content: customerMessage },
      });

      const result = await this.commerceAi.handleMessage(tenantId, conversation.id, contact.id, evalPhone, customerMessage, undefined, { dryRunPayment: true });

      await this.prisma.message.create({
        data: {
          tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'OUTBOUND', type: 'TEXT', status: 'SENT',
          content: result.response || '(no response)', metadata: { aiGenerated: true, commerce: true, evalRun: true },
        },
      });

      const draft = await this.prisma.order.findFirst({ where: { tenantId, conversationId: conversation.id }, orderBy: { createdAt: 'desc' } });
      if (draft && !orderId) orderId = draft.id;

      turns.push({
        customerMessage,
        aiResponse: result.response,
        blocked: result.blocked,
        toolTrace: result.toolTrace ?? [],
        orderStatusAfterTurn: draft?.status,
        mediaToSend: result.mediaToSend ?? [],
        scriptedTurn,
      });
    }

    const realOrderItems = orderId
      ? await this.prisma.orderItem.findMany({ where: { orderId }, select: { productId: true, quantity: true } })
      : [];

    const scored = await this.scoring.scoreCase(tenantId, scenario, turns, resolved, realOrderItems);

    return {
      status: scored.passed ? EvaluationCaseStatus.PASSED : EvaluationCaseStatus.FAILED,
      contactId: contact.id,
      conversationId: conversation.id,
      orderId,
      transcript: turns,
      scores: scored.scores,
      failureReasons: scored.failureReasons,
      criticalFailure: scored.criticalFailure,
    };
  }

  private resolveSelector(slot: string, selector: ProductSelector, catalogue: { id: string; name: string; priceMajorUnits: number; stockQuantity: number | null }[]): ResolvedProductRef | null {
    switch (selector.type) {
      case 'nonexistent':
        return { slot, id: null, name: NONEXISTENT_PRODUCT_NAME };
      case 'any':
        return catalogue[0] ? { slot, id: catalogue[0].id, name: catalogue[0].name } : null;
      case 'cheapest': {
        const p = [...catalogue].sort((a, b) => a.priceMajorUnits - b.priceMajorUnits)[0];
        return p ? { slot, id: p.id, name: p.name } : null;
      }
      case 'mostExpensive': {
        const p = [...catalogue].sort((a, b) => b.priceMajorUnits - a.priceMajorUnits)[0];
        return p ? { slot, id: p.id, name: p.name } : null;
      }
      case 'outOfStock': {
        const p = catalogue.find((c) => c.stockQuantity === 0);
        return p ? { slot, id: p.id, name: p.name } : null;
      }
      case 'unlimitedStock': {
        const p = catalogue.find((c) => c.stockQuantity === null);
        return p ? { slot, id: p.id, name: p.name } : null;
      }
      case 'nameContains': {
        const p = catalogue.find((c) => c.name.toLowerCase().includes(selector.value.toLowerCase()));
        return p ? { slot, id: p.id, name: p.name } : null;
      }
      default:
        return null;
    }
  }

  private fillPlaceholders(template: string, resolved: ResolvedProductRef[]): string {
    return resolved.reduce((text, ref) => text.replaceAll(`{{product:${ref.slot}}}`, ref.name), template);
  }
}
