import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(100),
  templateId: z.string().uuid('Invalid template'),
  templateVariables: z.record(z.string()).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  segmentId: z.string().uuid().optional(),
  labels: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial();

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
