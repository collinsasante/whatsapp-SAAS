import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaystackGateway } from '../billing/gateways/paystack.gateway';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { LedgerController } from './ledger/ledger.controller';
import { CommerceLedgerService } from './ledger/commerce-ledger.service';
import { CommerceWebhookController } from './webhooks/commerce-webhook.controller';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { CommerceAiService } from './ai/commerce-ai.service';
import { CommerceTestChatController } from './test-chat/commerce-test-chat.controller';
import { CommerceTestChatService } from './test-chat/commerce-test-chat.service';

// Managed Commerce (Phase 1, single-pilot-tenant). Sibling to BillingModule --
// commerce has its own domain objects (Order/Product/CommerceLedgerEntry, not
// Subscription/Invoice) so it stays a separate module rather than folding into
// billing, matching how campaigns/automation/templates are all separate from
// messages. Re-provides PaystackGateway directly (not exported from
// BillingModule today) rather than depending on billing's public surface.
@Module({
  imports: [PrismaModule, ConfigModule, AuditModule, KnowledgeBaseModule, ConversationsModule],
  controllers: [ProductsController, OrdersController, LedgerController, CommerceWebhookController, ReconciliationController, CommerceTestChatController],
  providers: [ProductsService, OrdersService, CommerceLedgerService, ReconciliationService, PaystackGateway, CommerceAiService, CommerceTestChatService],
  exports: [CommerceLedgerService, OrdersService, CommerceAiService, ProductsService],
})
export class CommerceModule {}
