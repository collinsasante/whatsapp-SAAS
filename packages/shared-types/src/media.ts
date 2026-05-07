import { MediaType } from './enums';

export interface MediaAsset {
  id: string;
  tenantId: string;
  uploadedById: string;
  type: MediaType;
  originalName: string;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: Date;
}
