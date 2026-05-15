import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto, ImportContactsDto } from './dto/contact.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new contact' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all contacts with pagination, search, and date filters' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
    @Query('label') label?: string,
    @Query('segmentId') segmentId?: string,
    @Query('isBlocked') isBlocked?: string,
    @Query('optedOut') optedOut?: string,
    @Query('dateField') dateField?: string,
    @Query('datePreset') datePreset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('conversationStatus') conversationStatus?: string,
  ) {
    const blocked = isBlocked === 'true' ? true : isBlocked === 'false' ? false : undefined;
    const opted = optedOut === 'true' ? true : optedOut === 'false' ? false : undefined;
    const validDateFields = ['createdAt', 'lastMessage', 'lastActive'] as const;
    const validPresets = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
    const df = validDateFields.includes(dateField as typeof validDateFields[number]) ? dateField as typeof validDateFields[number] : undefined;
    const dp = validPresets.includes(datePreset as typeof validPresets[number]) ? datePreset as typeof validPresets[number] : undefined;
    return this.contactsService.findAll(
      tenantId, +page, +limit, search, label, segmentId, blocked, opted,
      df, dp, dateFrom, dateTo, assignedAgentId, conversationStatus,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by ID' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.contactsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contact' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete contact' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.contactsService.remove(tenantId, id);
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import contacts' })
  bulkImport(@CurrentTenant() tenantId: string, @Body() dto: ImportContactsDto) {
    return this.contactsService.bulkImport(tenantId, dto);
  }
}
