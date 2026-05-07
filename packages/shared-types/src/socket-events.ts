import { Message } from './message';
import { Conversation } from './conversation';
import { MessageStatus } from './enums';

export interface SocketNewMessageEvent {
  conversationId: string;
  message: Message;
}

export interface SocketMessageStatusEvent {
  messageId: string;
  whatsappMessageId: string;
  status: MessageStatus;
  conversationId: string;
}

export interface SocketConversationUpdatedEvent {
  conversation: Partial<Conversation> & { id: string };
}

export interface SocketTypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface SocketAgentPresenceEvent {
  userId: string;
  isOnline: boolean;
}

export enum SocketEvent {
  NEW_MESSAGE = 'new_message',
  MESSAGE_STATUS_UPDATE = 'message_status_update',
  CONVERSATION_UPDATED = 'conversation_updated',
  TYPING_START = 'typing_start',
  TYPING_STOP = 'typing_stop',
  AGENT_ONLINE = 'agent_online',
  AGENT_OFFLINE = 'agent_offline',
  JOIN_TENANT = 'join_tenant',
  JOIN_CONVERSATION = 'join_conversation',
  LEAVE_CONVERSATION = 'leave_conversation',
}
