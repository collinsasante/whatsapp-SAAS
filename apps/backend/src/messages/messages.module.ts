import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { LinkPreviewController } from './link-preview.controller';
import { MessageSearchController } from './message-search.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ContactsModule } from '../contacts/contacts.module';
import { MediaModule } from '../media/media.module';
import { ChatbotFlowsModule } from '../chatbot-flows/chatbot-flows.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { AiModule } from '../ai/ai.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [WhatsappModule, ConversationsModule, ContactsModule, MediaModule, ChatbotFlowsModule, ActivityLogModule, AiModule, KnowledgeBaseModule, AiLogsModule],
  controllers: [MessagesController, LinkPreviewController, MessageSearchController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
