import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'AGENT', 'VIEWER']).optional().default('AGENT'),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(2, 'Workspace name must be at least 2 characters').optional(),
  logoUrl: z.string().url().optional().nullable(),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
