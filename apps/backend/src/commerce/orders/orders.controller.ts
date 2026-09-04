import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { UserRole, JwtPayload } from '@whatsapp-platform/shared-types';
import { OrdersService } from './orders.service';
import { CommerceLedgerService } from '../ledger/commerce-ledger.service';
import { CreateDraftOrderDto, AddOrderItemDto, SubmitForPaymentDto, CancelOrderDto, UpdateFulfillmentDto, ApproveOrderDto, RejectOrderDto } from './dto/order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';

@ApiTags('Commerce Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('commerce/orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly ledgerService: CommerceLedgerService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft order' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateDraftOrderDto) {
    return this.ordersService.createDraft(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List orders' })
  findAll(@CurrentTenant() tenantId: string, @Query('status') status?: OrderStatus) {
    return this.ordersService.findAll(tenantId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order with items, events, and ledger entries' })
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.ordersService.findOneWithDetails(tenantId, id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add an item to a DRAFT order' })
  addItem(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: AddOrderItemDto) {
    return this.ordersService.addItem(tenantId, id, dto);
  }

  @Post(':id/submit-for-payment')
  @ApiOperation({ summary: 'Move a DRAFT order to PENDING_PAYMENT and initiate Paystack collection' })
  submitForPayment(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: SubmitForPaymentDto) {
    return this.ordersService.submitForPayment(tenantId, id, dto.customerEmail);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a DRAFT or PENDING_PAYMENT order' })
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.ordersService.cancel(tenantId, id, dto.reason);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Approve an AWAITING_APPROVAL order and send the customer a real payment link (same Paystack path as a normal checkout)' })
  approve(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ApproveOrderDto) {
    return this.ordersService.approveOrder(tenantId, id, user.sub, dto.customerEmail);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Reject an AWAITING_APPROVAL order (cancels it) and resolve the linked task' })
  reject(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RejectOrderDto) {
    return this.ordersService.rejectOrder(tenantId, id, user.sub, dto.reason);
  }

  @Patch(':id/fulfillment')
  @ApiOperation({ summary: 'Update fulfillment status of a PAID order (rejects PAID as a target -- that only happens via a verified payment webhook)' })
  updateFulfillment(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateFulfillmentDto) {
    return this.ordersService.updateFulfillmentStatus(tenantId, id, dto.status);
  }

  @Post(':id/verify-payment')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Ask Paystack directly whether this order was paid, and promote it to PAID only on a verified success -- pull-based counterpart to the webhook' })
  verifyPayment(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.ledgerService.verifyAndRecordPayment(tenantId, id);
  }
}
