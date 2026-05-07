import { ConversationStatus } from './enums';

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  assignedToId: string | null;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  snoozedUntil: Date | null;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationNote {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}
