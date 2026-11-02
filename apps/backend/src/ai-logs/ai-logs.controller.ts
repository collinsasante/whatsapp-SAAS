import { Controller, ForbiddenException, Get, Patch, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DevToolsGuard } from '../common/guards/dev-tools.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { AiLogsService } from './ai-logs.service';
import { AiResponderService } from '../ai/ai-responder.service';
import { detectInjection } from '../ai-core/guards/injection-patterns';
import { SimulationLimitsService } from '../ai-core/simulation/simulation-limits.service';
import { VerzAiPipelineService } from '../ai-core/pipeline/verz-ai-pipeline.service';
import { AiAgentsService } from '../ai-core/agents/ai-agents.service';
import { SecurityRefusalService } from '../ai-core/refusal/security-refusal.service';

/** The sandbox has no stored conversation: this id only labels its (simulated) executions, and finds no history. */
const SANDBOX_CONVERSATION_ID = 'sandbox-test';

@UseGuards(JwtAuthGuard)
@Controller('ai-logs')
export class AiLogsController {
  constructor(
    private svc: AiLogsService,
    private aiResponder: AiResponderService,
    private limits: SimulationLimitsService,
    private pipeline: VerzAiPipelineService,
    private agents: AiAgentsService,
    private securityRefusal: SecurityRefusalService,
  ) {}

  /** GET /ai-logs/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD */
  @Get('analytics')
  analytics(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.svc.getAnalytics(user.tenantId, fromDate, toDate);
  }

  /** GET /ai-logs/:conversationId */
  @Get(':conversationId')
  findByConversation(
    @CurrentUser() user: JwtPayload,
    @Param('conversationId') conversationId: string,
  ) {
    return this.svc.findByConversation(user.tenantId, conversationId);
  }

  /** PATCH /ai-logs/:id/status  body: { status, finalSentMessage? } */
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: string; finalSentMessage?: string },
  ) {
    return this.svc.updateStatus(
      user.tenantId,
      id,
      body.status as Parameters<AiLogsService['updateStatus']>[2],
      user.sub,
      body.finalSentMessage,
    );
  }

  /** POST /ai-logs/test  body: { message }  — sandbox test without saving a real log */
  @Post('test')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(RolesGuard, DevToolsGuard)
  @Roles(UserRole.ADMIN)
  async test(
    @CurrentUser() user: JwtPayload,
    @Body() body: { message: string },
  ) {
    // The pipeline itself has no enablement/credit gate (only the AUTO_REPLY
    // production path checks shouldRespond() before calling it) -- without this,
    // sandbox testing could burn real DeepSeek calls on a tenant with AI disabled
    // or zero credits, with no limit on how many times.
    const usable = await this.aiResponder.isAiUsable(user.tenantId);
    if (!usable) {
      throw new ForbiddenException('VerzAI is not enabled for this workspace, or you are out of AI credits.');
    }

    // The sandbox makes a real, unmetered provider call, so it shares the simulated-AI limits with the test chats.
    if (typeof body.message === 'string') this.limits.assertInputSize(user.tenantId, body.message);

    // Was a 7-of-10 partial duplicate of the injection list; now the canonical
    // list from ai-core/guards, shared with the v2 pipeline's GuardStage.
    const injectionDetected = detectInjection(body.message);
    const startMs = Date.now();
    // The same VerzAI v2 pipeline (the Digital Self) that answers customers: guard, workspace context and knowledge, the current
    // prompt, generation, policy and escalation, with the workspace's default agent. It runs as a simulated TEST task, so it is
    // unmetered and nothing reaches a channel. A blocked message gets the same natural refusal a customer would. Differences from a
    // live conversation, by design: no contact, so no tools; no stored history; and no real handoff (`escalated` only reports
    // that a person would have been asked for).
    const { value: result } = await this.limits.execute(
      { tenantId: user.tenantId, userId: user.sub, kind: 'ai-sandbox' },
      async () => {
        const agent = await this.agents.findOrCreateDefaultAgent(user.tenantId);
        const run = await this.pipeline.run({
          tenantId: user.tenantId,
          agentId: agent.id,
          conversationId: SANDBOX_CONVERSATION_ID,
          customerMessage: body.message,
          taskType: 'TEST',
          simulated: true,
        });
        if (!run.blocked) return run;
        const refusal = await this.securityRefusal.generate({ tenantId: user.tenantId, conversationId: SANDBOX_CONVERSATION_ID, simulated: true });
        return { ...run, response: refusal ?? '' };
      },
    );
    return {
      response: result.response,
      confidence: result.confidence,
      escalated: !!result.shouldEscalate,
      responseTimeMs: Date.now() - startMs,
      injectionBlocked: injectionDetected || result.blocked,
      safetyCheck: {
        injectionAttempt: injectionDetected,
        blockedByGuardrail: result.blocked,
      },
    };
  }

  /** PATCH /ai-logs/:id/feedback  body: { rating, label?, note? } */
  @Patch(':id/feedback')
  feedback(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { rating: number; label?: string; note?: string },
  ) {
    return this.svc.submitFeedback(user.tenantId, id, body.rating, body.label, body.note);
  }
}
