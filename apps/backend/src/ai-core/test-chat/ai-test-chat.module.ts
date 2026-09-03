import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MessagesModule } from '../../messages/messages.module';
import { ConversationsModule } from '../../conversations/conversations.module';
import { AiTestChatService } from './ai-test-chat.service';
import { AiTestChatController } from './ai-test-chat.controller';

/**
 * Deliberately standalone (not part of AiCoreModule): only depends on
 * MessagesService, not on anything AiCoreModule provides. MessagesModule
 * already imports AiCoreModule, so nesting this inside AiCoreModule and
 * importing MessagesModule from there would create a second circular
 * dependency on top of the existing KnowledgeBaseModule <-> AiCoreModule one.
 *
 * ConversationsModule is imported so this service can resolve "the" active
 * conversation for its synthetic contact via the exact same
 * ConversationsService.findOrCreate() that handleInbound() uses internally --
 * see the comment on findOrCreateSession() for why that matters.
 */
@Module({
  imports: [PrismaModule, MessagesModule, ConversationsModule],
  controllers: [AiTestChatController],
  providers: [AiTestChatService],
})
export class AiTestChatModule {}
