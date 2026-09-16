import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WhatsAppNumbersService } from './whatsapp-numbers.service';
import { CreateWhatsAppNumberDto, UpdateWhatsAppNumberDto } from './dto/whatsapp-number.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentTenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';

@ApiTags('WhatsApp Numbers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp-numbers')
export class WhatsAppNumbersController {
  constructor(private readonly service: WhatsAppNumbersService) {}

  @Get()
  @ApiOperation({ summary: 'List all WhatsApp numbers for the workspace' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Add a new WhatsApp number to the workspace' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateWhatsAppNumberDto) {
    return this.service.create(tenantId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a WhatsApp number' })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWhatsAppNumberDto,
  ) {
    return this.service.update(tenantId, id, dto, user.sub);
  }

  @Patch(':id/set-default')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a number as the default for outgoing messages' })
  setDefault(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.setDefault(tenantId, id, user.sub);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Disconnect a WhatsApp number (soft -- conversations/messages/analytics are preserved)' })
  remove(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.remove(tenantId, id, user.sub);
  }

  @Patch(':id/reconnect')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Re-activate a disconnected WhatsApp number, optionally with fresh credentials' })
  reconnect(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWhatsAppNumberDto,
  ) {
    return this.service.reconnect(tenantId, id, dto, user.sub);
  }

  @Post(':id/test-connection')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify this number's stored credentials still work against the Meta Graph API" })
  testConnection(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.testConnection(tenantId, id, user.sub);
  }
}
