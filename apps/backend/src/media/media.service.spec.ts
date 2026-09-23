import { BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';

function build() {
  const prisma = {
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'asset-1' }),
    },
  };
  const storageService = {
    upload: jest.fn().mockResolvedValue({ fileKey: 'tenant-1/abc.jpg', fileUrl: 'https://cdn/tenant-1/abc.jpg' }),
  };
  const service = new MediaService(prisma as never, storageService as never);
  return { service, prisma, storageService };
}

function file(mimetype: string, originalname = 'upload.bin'): Express.Multer.File {
  return { mimetype, originalname, size: 100 } as Express.Multer.File;
}

describe('MediaService.upload -- file-type allowlist (stored XSS regression)', () => {
  it('rejects text/html outright', async () => {
    const { service, storageService } = build();
    await expect(service.upload('tenant-1', 'user-1', file('text/html'))).rejects.toThrow(BadRequestException);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('rejects image/svg+xml outright', async () => {
    const { service, storageService } = build();
    await expect(service.upload('tenant-1', 'user-1', file('image/svg+xml'))).rejects.toThrow(BadRequestException);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('rejects application/javascript outright', async () => {
    const { service, storageService } = build();
    await expect(service.upload('tenant-1', 'user-1', file('application/javascript'))).rejects.toThrow(BadRequestException);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('accepts a whitelisted image type and classifies it as IMAGE', async () => {
    const { service, prisma } = build();
    await service.upload('tenant-1', 'user-1', file('image/png'));
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'IMAGE' }) }),
    );
  });

  it('accepts a whitelisted document type and classifies it as DOCUMENT', async () => {
    const { service, prisma } = build();
    await service.upload('tenant-1', 'user-1', file('application/pdf'));
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'DOCUMENT' }) }),
    );
  });

  it('never reaches storage or the duplicate-name check for a rejected type', async () => {
    const { service, prisma, storageService } = build();
    await expect(service.upload('tenant-1', 'user-1', file('text/html'))).rejects.toThrow();
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});
