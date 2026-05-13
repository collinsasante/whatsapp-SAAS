import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
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

  emitNewMessage(tenantId: string, conversationId: string, message: Record<string, unknown>) {
    void this.emit('new_message', { tenantId, conversationId, message });
  }

  emitMessageStatus(tenantId: string, data: { messageId: string; whatsappMessageId: string; status: MessageStatus; conversationId: string }) {
    void this.emit('message_status_update', { tenantId, ...data });
  }

  emitConversationUpdated(tenantId: string, conversationId: string, data: Record<string, unknown>) {
    void this.emit('conversation_updated', { tenantId, conversationId, ...data });
  }

  emitConversationStateChanged(tenantId: string, conversationId: string, data: Record<string, unknown>) {
    void this.emit('conversation_state_changed', { tenantId, conversationId, ...data });
    // Also emit general update so inbox list refreshes
    void this.emit('conversation_updated', { tenantId, conversationId, ...data });
  }

  emitActivityLog(tenantId: string, conversationId: string, activity: Record<string, unknown>) {
    void this.emit('activity_log', { tenantId, conversationId, activity });
  }

  emitMessageEdited(tenantId: string, conversationId: string, message: Record<string, unknown>) {
    void this.emit('message_edited', { tenantId, conversationId, message });
  }

  emitMessageDeleted(tenantId: string, conversationId: string, messageId: string, scope: string) {
    void this.emit('message_deleted', { tenantId, conversationId, messageId, scope });
  }

  emitCallEvent(tenantId: string, event: string, call: Record<string, unknown>) {
    void this.emit(event, { tenantId, call });
  }

  // Emit to a specific user's personal room
  emitReactionUpdated(tenantId: string, conversationId: string, messageId: string, reactions: Record<string, unknown>[]) {
    void this.emit('reaction_updated', { tenantId, conversationId, messageId, reactions });
  }

  emitToUser(userId: string, event: string, data: unknown) {
    void this.emit(event, { userId, data });
  }
}
