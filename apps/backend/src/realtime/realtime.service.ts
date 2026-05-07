import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Message } from '@prisma/client';
import { MessageStatus } from '@whatsapp-platform/shared-types';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly realtimeUrl: string;

  constructor(private configService: ConfigService) {
    this.realtimeUrl = this.configService.get<string>('app.realtimeUrl', 'http://realtime:3002');
  }

  private async emit(event: string, payload: unknown) {
    try {
      await axios.post(`${this.realtimeUrl}/internal/emit`, { event, payload }, { timeout: 5000 });
    } catch (error) {
      this.logger.warn(`Failed to emit realtime event ${event}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  emitNewMessage(tenantId: string, conversationId: string, message: Message) {
    void this.emit('new_message', { tenantId, conversationId, message });
  }

  emitMessageStatus(tenantId: string, data: { messageId: string; whatsappMessageId: string; status: MessageStatus; conversationId: string }) {
    void this.emit('message_status_update', { tenantId, ...data });
  }

  emitConversationUpdated(tenantId: string, conversationId: string, data: Record<string, unknown>) {
    void this.emit('conversation_updated', { tenantId, conversationId, ...data });
  }
}
