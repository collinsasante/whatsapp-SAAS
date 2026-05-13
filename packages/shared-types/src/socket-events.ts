import { Message } from './message';
import { Conversation } from './conversation';
import { ActivityLog } from './activity-log';
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

export interface SocketActivityLogEvent {
  conversationId: string;
  activity: ActivityLog;
}

export interface SocketReactionEvent {
  conversationId: string;
  messageId: string;
  emoji: string;
  userId: string | null;
  action: 'add' | 'remove';
}

export enum SocketEvent {
  NEW_MESSAGE = 'new_message',
  MESSAGE_STATUS_UPDATE = 'message_status_update',
  CONVERSATION_UPDATED = 'conversation_updated',
  CONVERSATION_STATE_CHANGED = 'conversation_state_changed',
  TYPING_START = 'typing_start',
  TYPING_STOP = 'typing_stop',
  AGENT_ONLINE = 'agent_online',
  AGENT_OFFLINE = 'agent_offline',
  JOIN_TENANT = 'join_tenant',
  JOIN_CONVERSATION = 'join_conversation',
  LEAVE_CONVERSATION = 'leave_conversation',
  ACTIVITY_LOG = 'activity_log',
  REACTION_UPDATED = 'reaction_updated',
  CALL_CREATED = 'call_created',
  CALL_UPDATED = 'call_updated',
}
