import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentTenant } from '../common/decorators/tenant.decorator';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('messages')
export class MessageSearchController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('search')
  @ApiOperation({ summary: 'Global full-text search across all conversations' })
  search(
    @CurrentTenant() tenantId: string,
    @Query('q') q: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.messagesService.globalSearch(tenantId, q ?? '', +page, +limit);
  }
}
