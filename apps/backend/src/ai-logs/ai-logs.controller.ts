import { Controller, ForbiddenException, Get, Patch, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { AiLogsService } from './ai-logs.service';
import { AiResponderService } from '../ai/ai-responder.service';
import { detectInjection } from '../ai-core/guards/injection-patterns';

@UseGuards(JwtAuthGuard)
@Controller('ai-logs')
export class AiLogsController {
  constructor(
    private svc: AiLogsService,
    private aiResponder: AiResponderService,
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
  async test(
    @CurrentUser() user: JwtPayload,
    @Body() body: { message: string },
  ) {
    // generateSuggestion() itself has no enablement/credit gate (only the
    // AUTO_REPLY production path checks shouldRespond() before calling it) --
    // without this, sandbox testing could burn real DeepSeek calls on a tenant
    // with AI disabled or zero credits, with no limit on how many times.
    const usable = await this.aiResponder.isAiUsable(user.tenantId);
    if (!usable) {
      throw new ForbiddenException('VerzAI is not enabled for this workspace, or you are out of AI credits.');
    }

    // Was a 7-of-10 partial duplicate of the injection list; now the canonical
    // list from ai-core/guards, shared with the v2 pipeline's GuardStage.
    const injectionDetected = detectInjection(body.message);
    const startMs = Date.now();
    const result = await this.aiResponder.generateSuggestion(user.tenantId, 'sandbox-test', body.message);
    return {
      response: result.response,
      confidence: result.confidence,
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
