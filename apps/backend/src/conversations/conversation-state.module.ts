import { Global, Module } from '@nestjs/common';
import { ConversationStateService } from './conversation-state.service';

/**
 * Verz-AI unification, Phase F: global like PrismaModule/MonitoringModule --
 * ConversationStateService is needed from several call sites that already sit
 * inside a carefully-managed 3-module circular-dependency tangle (CommerceModule
 * <-> ConversationsModule <-> AiCoreModule, see conversations.module.ts's own
 * comment). Threading one more cross-cutting service through that same cycle
 * would just add another forwardRef() edge for no benefit; global sidesteps it
 * entirely, the same reasoning MonitoringModule already established this session.
 */
@Global()
@Module({
  providers: [ConversationStateService],
  exports: [ConversationStateService],
})
export class ConversationStateModule {}
