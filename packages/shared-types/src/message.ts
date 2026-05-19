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
  replyToId: string | null;
  isStarred: boolean;
  isPinned: boolean;
  isEdited: boolean;
  editedAt: Date | null;
  deletedForEveryone: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  sender?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  replyTo?: {
    id: string;
    content: string | null;
    type: MessageType;
    direction: MessageDirection;
    mediaCaption: string | null;
  } | null;
}
