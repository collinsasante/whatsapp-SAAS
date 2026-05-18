import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @Roles(UserRole.AGENT)
  @ApiOperation({ summary: 'Send a message in a conversation' })
  send(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(tenantId, conversationId, user.sub, dto, user.role);
  }

  @Get()
  @ApiOperation({ summary: 'Get messages for a conversation' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
  ) {
    return this.messagesService.findByConversation(tenantId, conversationId, +page, +limit, search);
  }

  @Post(':messageId/react')
  @ApiOperation({ summary: 'Add emoji reaction to a message' })
  react(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
    @Body('emoji') emoji: string,
  ) {
    return this.messagesService.addReaction(tenantId, conversationId, messageId, user.sub, emoji);
  }

  @Delete(':messageId/react')
  @ApiOperation({ summary: 'Remove emoji reaction from a message' })
  removeReact(
    @CurrentTenant() tenantId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
    @Body('emoji') emoji: string,
  ) {
    return this.messagesService.removeReaction(tenantId, messageId, user.sub, emoji);
  }

  @Patch(':messageId/star')
  @ApiOperation({ summary: 'Toggle star on a message' })
  star(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.toggleStar(tenantId, conversationId, messageId);
  }

  @Patch(':messageId/pin')
  @ApiOperation({ summary: 'Toggle pin on a message' })
  pin(
    @CurrentTenant() tenantId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messagesService.togglePin(tenantId, conversationId, messageId, user.sub);
  }

}
