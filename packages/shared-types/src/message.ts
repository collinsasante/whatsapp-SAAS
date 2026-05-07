import { MessageStatus, MessageType, MessageDirection } from './enums';

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  contactId: string;
  senderId: string | null;
  whatsappMessageId: string | null;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaSize: number | null;
  mediaCaption: string | null;
  templateId: string | null;
  templateVariables: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}
