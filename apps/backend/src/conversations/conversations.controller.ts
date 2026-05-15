import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConversationsService } from './conversations.service';
import {
  CreateConversationDto, UpdateConversationDto, CreateNoteDto,
  RequestSupportDto, TransferConversationDto,
} from './dto/conversation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, ConversationStatus } from '@whatsapp-platform/shared-types';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({ summary: 'Start a new conversation' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateConversationDto, @CurrentUser() user: JwtPayload) {
    return this.conversationsService.create(tenantId, dto, user.sub);
  }

  @Post('find-or-create')
  @ApiOperation({ summary: 'Find existing open conversation or create one' })
  findOrCreate(@CurrentTenant() tenantId: string, @Body() body: { contactId: string }) {
    return this.conversationsService.findOrCreate(tenantId, body.contactId);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import conversations from CSV (AiSensy or generic format)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importCsv(
    @CurrentTenant() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.conversationsService.importFromCsv(tenantId, file.buffer.toString('utf-8'));
  }

  @Get()
  @ApiOperation({ summary: 'Get conversations with status filter' })
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

  @Get('counts')
  @ApiOperation({ summary: 'Get conversation counts per status' })
  getCounts(@CurrentTenant() tenantId: string) {
    return this.conversationsService.getStatusCounts(tenantId);
  }

  @Post(':id/summarize')
  @ApiOperation({ summary: 'AI-summarize a conversation' })
  summarize(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.summarize(tenantId, id);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update conversation (assign, label, snooze, priority)' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.update(tenantId, id, dto, user.sub);
  }

  // ─── State transitions ────────────────────────────────────────────────────

  @Post(':id/request')
  @ApiOperation({ summary: 'Customer or bot requests human support (→ REQUESTED)' })
  request(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: RequestSupportDto,
  ) {
    return this.conversationsService.request(tenantId, id, dto.reason);
  }

  @Post(':id/intervene')
  @ApiOperation({ summary: 'Agent takes over the conversation (→ INTERVENED)' })
  intervene(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.conversationsService.intervene(tenantId, id, user.sub);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve a conversation (→ RESOLVED)' })
  resolve(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.conversationsService.resolve(tenantId, id, user.sub);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a resolved conversation (→ OPEN)' })
  reopen(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.conversationsService.reopen(tenantId, id, user.sub);
  }

  @Post(':id/transfer')
  @ApiOperation({ summary: 'Transfer conversation to another agent' })
  transfer(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: TransferConversationDto,
  ) {
    return this.conversationsService.transfer(tenantId, id, user.sub, dto);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  @Patch(':id/read')
  markRead(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.markRead(tenantId, id);
  }

  @Get(':id/notes')
  getNotes(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.getNotes(tenantId, id);
  }

  @Post(':id/notes')
  addNote(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateNoteDto,
  ) {
    return this.conversationsService.addNote(tenantId, id, user.sub, dto);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Get conversation lifecycle events (timeline)' })
  getEvents(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.getEvents(tenantId, id);
  }

  @Delete(':id')
  deleteConversation(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.deleteConversation(tenantId, id);
  }

}
