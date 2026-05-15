import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import {
  CreateCallDto, UpdateCallDto, ListCallsDto, CreateCallNoteDto,
  TransferCallDto, MuteCallDto, HoldCallDto, AnalyticsQueryDto, InitiateCallDto, RespondCallDto,
} from './dto/call.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload } from '@whatsapp-platform/shared-types';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get call stats for dashboard' })
  getStats(@CurrentTenant() tenantId: string) {
    return this.callsService.getStats(tenantId);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get call analytics (avg duration, missed rate, response time)' })
  getAnalytics(@CurrentTenant() tenantId: string, @Query() dto: AnalyticsQueryDto) {
    return this.callsService.getAnalytics(tenantId, dto);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Check if a user has granted call permission' })
  getCallPermission(@CurrentTenant() tenantId: string, @Query('phone') phone: string) {
    return this.callsService.getCallPermission(tenantId, phone);
  }

  @Post('permissions/request')
  @ApiOperation({ summary: 'Send a call permission request message to a user' })
  requestCallPermission(@CurrentTenant() tenantId: string, @Body('phone') phone: string) {
    return this.callsService.requestCallPermission(tenantId, phone);
  }

  @Post('initiate')
  @ApiOperation({ summary: 'Initiate a real WhatsApp call via Meta API' })
  initiateCall(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateCallDto,
  ) {
    return this.callsService.initiateCall(tenantId, user.sub, dto);
  }

  @Post('links/generate')
  @ApiOperation({ summary: 'Generate a tokenized call link (24h expiry)' })
  generateLink(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.callsService.generateCallLink(tenantId, user.sub);
  }

  @Get('links/:token')
  @ApiOperation({ summary: 'Validate a call link token' })
  validateLink(@Param('token') token: string) {
    return this.callsService.validateCallLink(token);
  }

  @Get()
  @ApiOperation({ summary: 'List all calls with filters' })
  findAll(@CurrentTenant() tenantId: string, @Query() dto: ListCallsDto) {
    return this.callsService.findAll(tenantId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Log a new call' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCallDto,
  ) {
    return this.callsService.create(tenantId, user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get call by ID' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.callsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update call status / duration' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCallDto,
  ) {
    return this.callsService.update(tenantId, id, dto);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Toggle archive status on a call' })
  archive(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.callsService.archive(tenantId, id);
  }

  @Patch(':id/mute')
  @ApiOperation({ summary: 'Mute or unmute an active call (syncs via socket)' })
  mute(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: MuteCallDto,
  ) {
    return this.callsService.mute(tenantId, id, dto);
  }

  @Patch(':id/hold')
  @ApiOperation({ summary: 'Hold or resume an active call (syncs via socket)' })
  hold(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: HoldCallDto,
  ) {
    return this.callsService.hold(tenantId, id, dto);
  }

  @Post(':id/transfer')
  @ApiOperation({ summary: 'Transfer a call to another agent' })
  transfer(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: TransferCallDto,
  ) {
    return this.callsService.transfer(tenantId, id, user.sub, dto);
  }

  @Post(':id/respond')
  @ApiOperation({ summary: 'Respond to an inbound WhatsApp call (accept/pre_accept/reject/terminate)' })
  respondToCall(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: RespondCallDto,
  ) {
    return this.callsService.respondToCall(tenantId, id, dto.action, dto.sdpAnswer);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add internal note to a call' })
  addNote(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCallNoteDto,
  ) {
    return this.callsService.addNote(tenantId, id, user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a call log' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.callsService.remove(tenantId, id);
  }
}
