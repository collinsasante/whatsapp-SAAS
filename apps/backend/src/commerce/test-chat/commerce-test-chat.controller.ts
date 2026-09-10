import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UserRole, JwtPayload } from '@whatsapp-platform/shared-types';
import { CommerceTestChatService } from './commerce-test-chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';

class TestChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}

/** Admin-only: drives the real commerce AI (real orders, real Paystack init). */
@ApiTags('Commerce Test Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('commerce/test-chat')
export class CommerceTestChatController {
  constructor(private readonly testChat: CommerceTestChatService) {}

  @Get()
  @ApiOperation({ summary: 'Current test-chat session: message history + latest order' })
  getState(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.testChat.getState(tenantId, user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Send a message as the test customer through the real commerce AI flow' })
  send(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: TestChatMessageDto) {
    return this.testChat.sendMessage(tenantId, user.sub, dto.message);
  }

  @Post('reset')
  @ApiOperation({ summary: 'Start a fresh test conversation (new cart/order context)' })
  reset(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.testChat.reset(tenantId, user.sub);
  }
}
