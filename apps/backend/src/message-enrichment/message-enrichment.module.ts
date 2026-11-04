import { Module, forwardRef } from '@nestjs/common';
import { MessageEnrichmentService } from './message-enrichment.service';
import { MediaModule } from '../media/media.module';
import { AiCoreModule } from '../ai-core/ai-core.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [MediaModule, AiCoreModule, RealtimeModule, forwardRef(() => MessagesModule)],
  providers: [MessageEnrichmentService],
  exports: [MessageEnrichmentService],
})
export class MessageEnrichmentModule {}
