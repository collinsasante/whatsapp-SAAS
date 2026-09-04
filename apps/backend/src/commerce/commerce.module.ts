import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { InternalTasksModule } from '../internal-tasks/internal-tasks.module';
import { AiCoreModule } from '../ai-core/ai-core.module';
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
  imports: [
    PrismaModule,
    ConfigModule,
    AuditModule,
    KnowledgeBaseModule,
    // ConversationsModule itself imports AiCoreModule (forwardRef'd there too, see
    // conversations.module.ts), and AiCoreModule now imports this module back -- a
    // 3-module JS require cycle (Commerce -> Conversations -> AiCore -> Commerce), not
    // just a 2-module DI cycle. Every edge in that cycle needs forwardRef(), not just
    // the direct Commerce<->AiCore one, or module-class references resolve to
    // `undefined` depending on which file's require() chain runs first.
    forwardRef(() => ConversationsModule),
    InternalTasksModule,
    forwardRef(() => AiCoreModule),
  ],
  controllers: [ProductsController, OrdersController, LedgerController, CommerceWebhookController, ReconciliationController, CommerceTestChatController],
  providers: [ProductsService, OrdersService, CommerceLedgerService, ReconciliationService, PaystackGateway, CommerceAiService, CommerceTestChatService],
  exports: [CommerceLedgerService, OrdersService, CommerceAiService, ProductsService],
})
export class CommerceModule {}
