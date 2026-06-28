import { z } from 'zod';

export const sendTextMessageSchema = z.object({
  type: z.literal('TEXT'),
  content: z.string().min(1, 'Message cannot be empty').max(4096),
  replyToId: z.string().uuid().optional(),
});

export const sendTemplateMessageSchema = z.object({
  type: z.literal('TEMPLATE'),
  templateId: z.string().uuid('Invalid template'),
  variables: z.record(z.string()).optional(),
});

export const sendMediaMessageSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']),
  mediaUrl: z.string().url('Invalid media URL'),
  caption: z.string().max(1024).optional(),
  filename: z.string().optional(),
});

export const sendMessageSchema = z.discriminatedUnion('type', [
  sendTextMessageSchema,
  sendTemplateMessageSchema,
  sendMediaMessageSchema,
]);

export type SendTextMessageInput = z.infer<typeof sendTextMessageSchema>;
export type SendTemplateMessageInput = z.infer<typeof sendTemplateMessageSchema>;
export type SendMediaMessageInput = z.infer<typeof sendMediaMessageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
