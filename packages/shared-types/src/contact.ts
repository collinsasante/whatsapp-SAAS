export interface Contact {
  id: string;
  tenantId: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  labels: string[];
  customFields: Record<string, string>;
  isBlocked: boolean;
  optedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
}
