import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto, UpdateConversationDto, CreateNoteDto } from './dto/conversation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';
import { ConversationStatus } from '@whatsapp-platform/shared-types';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({ summary: 'Start a new conversation' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateConversationDto) {
    return this.conversationsService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all conversations (inbox)' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 25,
    @Query('status') status?: ConversationStatus,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
  ) {
    return this.conversationsService.findAll(tenantId, +page, +limit, status, assignedToId, search);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single conversation' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update conversation (assign, label, snooze)' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversationsService.update(tenantId, id, dto);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve a conversation' })
  resolve(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.resolve(tenantId, id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  markRead(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.markRead(tenantId, id);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to a conversation' })
  addNote(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateNoteDto,
  ) {
    return this.conversationsService.addNote(tenantId, id, user.sub, dto);
  }
}
