import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiCoreModule } from '../ai-core/ai-core.module';
import { CommerceModule } from '../commerce/commerce.module';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadToolsRegistrar } from './lead-tools.registrar';

// One-directional dependency by design -- see lead-tools.registrar.ts. Neither
// AiCoreModule nor CommerceModule needs to import this module back, so this stays a
// plain DAG edge, no forwardRef() needed anywhere here.
//
// @Global(): CommerceLedgerService.recordPaymentSuccess (commerce/ledger/) needs
// LeadsService.markConverted, but CommerceModule can't import LeadsModule without
// recreating exactly the kind of require-cycle Phase A already hit once (LeadsModule
// already imports CommerceModule). @Global() lets LeadsService be injected there via a
// plain constructor dependency without adding that edge to CommerceModule's own
// `imports` array -- Nest resolves global providers without a declared import, and
// there's no actual JS-level circular `require` either: commerce-ledger.service.ts's
// import of leads.service.ts doesn't lead back to itself (leads.service.ts's own
// imports -- OrdersService, AiCompletionService -- never reach commerce-ledger.service.ts).
@Global()
@Module({
  imports: [PrismaModule, AiCoreModule, CommerceModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadToolsRegistrar],
  exports: [LeadsService],
})
export class LeadsModule {}
