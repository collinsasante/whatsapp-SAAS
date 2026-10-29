import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UserRole, JwtPayload } from '@whatsapp-platform/shared-types';
import { AiTestChatService } from './ai-test-chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DevToolsGuard } from '../../common/guards/dev-tools.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';

export class TestChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;

  /**
   * Optional id the page generates once per send. A retry of the same send (double click, a re-sent request) carries the same id, so
   * the server returns the stored result instead of calling the AI, and charging the test allowance, a second time.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'clientMessageId must be 8-64 letters, digits, - or _' })
  clientMessageId?: string;
}

/** Admin-only, non-production-only: drives the real general-purpose Verz-AI responder (SUGGESTION/AUTO_REPLY). */
@ApiTags('Verz-AI Test Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, DevToolsGuard)
@Roles(UserRole.ADMIN)
@Controller('ai/test-chat')
export class AiTestChatController {
  constructor(private readonly testChat: AiTestChatService) {}

  @Get()
  @ApiOperation({ summary: 'Current test-chat session: message history + suggestion log' })
  getState(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.testChat.getState(tenantId, user.sub);
  }

  @Get('usage')
  @ApiOperation({ summary: "This workspace's simulated-AI allowance and today's provider usage (counts, reported tokens, estimated cost). Admin only; own tenant only." })
  usage(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.testChat.getUsage(tenantId, user.sub);
  }

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message as the test customer. Simulated: generated and stored, never sent to a channel. Subject to the per-user, per-tenant and size limits.' })
  send(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: TestChatMessageDto) {
    return this.testChat.sendMessage(tenantId, user.sub, dto.message, dto.clientMessageId);
  }

  @Post('reset')
  @ApiOperation({ summary: 'Start a fresh test conversation' })
  reset(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.testChat.reset(tenantId, user.sub);
  }
}
