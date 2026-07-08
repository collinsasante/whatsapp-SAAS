import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { AiLogsService } from './ai-logs.service';
import { AiResponderService, detectInjection } from '../ai/ai-responder.service';

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

  /**
   * POST /ai-logs/test  body: { message }  — sandbox test without saving a
   * real log. Uses the exact same injection-pattern list as the live
   * pipeline (previously this endpoint kept its own shorter, drifted copy),
   * and surfaces retrieved sources + action + verification so a tenant can
   * see WHY an answer would or wouldn't have gone out before going live
   * (Phase 7.1 test console).
   */
  @Post('test')
  async test(
    @CurrentUser() user: JwtPayload,
    @Body() body: { message: string },
  ) {
    const injectionDetected = detectInjection(body.message);
    const result = await this.aiResponder.generateSuggestion(user.tenantId, 'sandbox-test', body.message);
    return {
      response: result.response,
      confidence: result.confidence,
      action: result.action,
      sources: result.retrievedChunks.filter((c) => result.sources.includes(c.id)).map((c) => ({ id: c.id, heading: c.heading, excerpt: c.content.slice(0, 200) })),
      verificationPassed: result.verificationPassed,
      verificationFailReason: result.verificationFailReason,
      responseTimeMs: result.responseTimeMs,
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
