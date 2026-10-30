import { AxiosError } from 'axios';
import { MessageStatus, MessageType } from '@whatsapp-platform/shared-types';
import { MessagesService } from './messages.service';

// A 1x1 lossy WebP: stored as image/webp, which WhatsApp does not accept as an image.
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const LINK = 'https://staging.verzchat.com:8443/api/v1/media/serve/tenant-secret-id~b7e1.webp';

function metaRejection(): AxiosError {
  const err = new AxiosError('Request failed with status code 400');
  err.response = { status: 400, data: { error: { message: '(#100) param file must be a file with one of the following types: image/jpeg, image/png' } } } as never;
  return err;
}

function buildDeliver(uploadFails: boolean) {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const whatsappService = {
    uploadMediaToMeta: uploadFails ? jest.fn().mockRejectedValue(metaRejection()) : jest.fn().mockResolvedValue('meta-media-1'),
    sendMediaMessageById: jest.fn().mockResolvedValue('wamid.id'),
    sendMediaMessage: jest.fn().mockResolvedValue('wamid.link'),
  };
  const service = Object.create(MessagesService.prototype) as Record<string, unknown>;
  Object.assign(service, { logger, whatsappService, loadMediaBuffer: jest.fn().mockResolvedValue({ buffer: WEBP, mimeType: 'image/webp' }) });
  const deliver = (service['deliverMedia'] as (...a: unknown[]) => Promise<string | undefined>).bind(service);
  return { logger, whatsappService, deliver };
}

describe('MessagesService.deliverMedia diagnostics', () => {
  it('logs what is being sent: the stored type, size and real format', async () => {
    const { logger, deliver } = buildDeliver(false);
    await deliver('t1', '+233555000111', MessageType.IMAGE, LINK);
    expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/Media send IMAGE: stored as image\/webp, \d+ bytes, actual format webp/));
  });

  it("logs Meta's own reason when the upload is refused, instead of only the HTTP status", async () => {
    const { logger, whatsappService, deliver } = buildDeliver(true);
    await expect(deliver('t1', '+233555000111', MessageType.IMAGE, LINK)).resolves.toBe('wamid.link');
    const warning = logger.warn.mock.calls[0][0] as string;
    expect(warning).toContain('param file must be a file with one of the following types');
    expect(warning).not.toContain('status code 400');
    expect(whatsappService.sendMediaMessage).toHaveBeenCalled(); // the fallback itself is unchanged
  });

  it('says which origin Meta has to fetch, without the storage key or any phone number', async () => {
    const { logger, deliver } = buildDeliver(true);
    await deliver('t1', '+233555000111', MessageType.IMAGE, LINK);
    const all = [...logger.log.mock.calls, ...logger.warn.mock.calls].map((c) => c[0]).join('\n');
    expect(all).toContain('https://staging.verzchat.com:8443');
    expect(all).not.toMatch(/tenant-secret-id|b7e1|233555000111/);
  });
});

describe('MessagesService.updateStatus diagnostics', () => {
  function build() {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const prisma = { message: { update: jest.fn().mockResolvedValue({}) }, campaignRecipient: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = Object.create(MessagesService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      logger, prisma,
      findMessageForReceipt: jest.fn().mockResolvedValue({ id: 'm1', type: 'IMAGE', status: MessageStatus.SENT, conversationId: 'c1' }),
    });
    return { logger, prisma, update: (service['updateStatus'] as (...a: unknown[]) => Promise<unknown>).bind(service) };
  }

  it("logs Meta's failure code and title with the message type when a send is reported failed", async () => {
    const { logger, update } = build();
    await update('wamid.x', MessageStatus.FAILED, 't1', [{ code: 131053, title: 'Media upload error' }]).catch(() => undefined);
    expect(logger.warn).toHaveBeenCalledWith('Meta reported FAILED for IMAGE message m1: 131053 Media upload error');
  });

  it('says so when Meta gives no error', async () => {
    const { logger, update } = build();
    await update('wamid.x', MessageStatus.FAILED, 't1', undefined).catch(() => undefined);
    expect(logger.warn).toHaveBeenCalledWith('Meta reported FAILED for IMAGE message m1: no error given');
  });
});
