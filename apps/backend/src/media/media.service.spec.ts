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

describe('MediaService.upload -- duplicate file names', () => {
  it('allows a reused name for chat/voice/other uploads (default)', async () => {
    const { service, prisma } = build();
    prisma.mediaAsset.findFirst.mockResolvedValue({ id: 'existing' });
    await service.upload('tenant-1', 'user-1', file('image/png', 'WhatsApp Image.jpeg'));
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
    expect(prisma.mediaAsset.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate name for File Library uploads, within the tenant only', async () => {
    const { service, prisma, storageService } = build();
    prisma.mediaAsset.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.upload('tenant-1', 'user-1', file('image/png', 'a.png'), true)).rejects.toThrow('already exists');
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', originalName: 'a.png' } });
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});

describe('MediaService.upload -- recorded voice notes (the reported failure)', () => {
  it.each([
    ['audio/webm;codecs=opus', 'what Chrome and Firefox record'],
    ['audio/webm', 'WebM without a parameter'],
    ['audio/mp4', 'what Safari records'],
    ['audio/ogg; codecs=opus', 'OGG with a spaced parameter'],
    ['AUDIO/WEBM;CODECS=OPUS', 'case differences'],
  ])('accepts %s (%s) as AUDIO and stores the bare type', async (mimetype) => {
    const { service, prisma, storageService } = build();
    const f = file(mimetype, 'voice-note.webm');
    await service.upload('tenant-1', 'user-1', f);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'AUDIO', mimeType: mimetype.split(';')[0]!.trim().toLowerCase() }) }));
    expect(storageService.upload.mock.calls[0][0].mimetype).not.toContain(';');
  });

  it('stripping parameters does not open a hole: dangerous types are still rejected, with or without a parameter', async () => {
    for (const bad of ['text/html', 'text/html;charset=utf-8', 'image/svg+xml', 'application/javascript;charset=utf-8', 'application/x-msdownload', '']) {
      const { service, storageService } = build();
      await expect(service.upload('tenant-1', 'user-1', file(bad))).rejects.toThrow(BadRequestException);
      expect(storageService.upload).not.toHaveBeenCalled();
    }
  });

  it('names the offending type in the error so the UI can show something useful', async () => {
    const { service } = build();
    await expect(service.upload('tenant-1', 'user-1', file('video/x-weird;foo=bar'))).rejects.toThrow('Unsupported file type: video/x-weird');
  });
});
