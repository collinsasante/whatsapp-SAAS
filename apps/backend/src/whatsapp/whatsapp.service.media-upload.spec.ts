import axios from 'axios';
import { WhatsAppService } from './whatsapp.service';
import { makeOversizedPng } from '../common/media/image.test-helpers';
import { WHATSAPP_IMAGE_MAX_BYTES } from '../common/media/image.util';

// real ffmpeg transcodes of a multi-megabyte image; slow when the suite runs in parallel, so the default 5 s limit is too tight.
jest.setTimeout(30_000);

jest.mock('axios');

// Tiny real files (see common/media/image.util.spec.ts).
const LOSSY_WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

function build() {
  (axios.post as jest.Mock).mockReset().mockResolvedValue({ data: { id: 'meta-media-1' } });
  const service = Object.create(WhatsAppService.prototype) as WhatsAppService & Record<string, unknown>;
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  Object.assign(service, {
    resolveCredentials: jest.fn().mockResolvedValue({ phoneNumberId: 'pn1', accessToken: 'token' }),
    graphBaseUrl: 'https://graph.example/v1',
    logger,
  });
  return { service, logger };
}

/** What Meta would receive in the multipart upload: the part headers and the first bytes of the file. */
function uploaded() {
  const form = (axios.post as jest.Mock).mock.calls[0][1] as { getBuffer: () => Buffer };
  const raw = form.getBuffer();
  const text = raw.toString('latin1');
  const filename = /filename="([^"]+)"/.exec(text)?.[1];
  const contentType = /Content-Type: ([^\r\n]+)/.exec(text)?.[1];
  const start = raw.indexOf('\r\n\r\n', raw.indexOf('name="file"')) + 4;
  return { filename, contentType, firstBytes: [...raw.subarray(start, start + 4)] };
}

describe('WhatsAppService.uploadMediaToMeta: images', () => {
  it.each([['WebP', LOSSY_WEBP, 'image/webp', 'media.webp'], ['GIF', GIF, 'image/gif', 'media.gif']])('converts a %s to JPEG before Meta sees it', async (_n, buf, mime, name) => {
    const { service } = build();
    expect(await service.uploadMediaToMeta('t1', buf, mime, name)).toBe('meta-media-1');
    expect(uploaded()).toMatchObject({ filename: 'media.jpg', contentType: 'image/jpeg', firstBytes: [0xff, 0xd8, 0xff, expect.any(Number)] });
  });

  it('converts a file whose label says JPEG but whose bytes are WebP', async () => {
    const { service } = build();
    await service.uploadMediaToMeta('t1', LOSSY_WEBP, 'image/jpeg', 'media.jpeg');
    expect(uploaded()).toMatchObject({ contentType: 'image/jpeg', firstBytes: [0xff, 0xd8, 0xff, expect.any(Number)] });
  });

  it('sends a real PNG and a real JPEG exactly as they are', async () => {
    for (const [buf, mime, name] of [[PNG, 'image/png', 'media.png'], [JPEG, 'image/jpeg', 'media.jpeg']] as const) {
      const { service } = build();
      await service.uploadMediaToMeta('t1', buf, mime, name);
      expect(uploaded()).toMatchObject({ filename: name, contentType: mime, firstBytes: [...buf.subarray(0, 4)] });
    }
  });

  it('shrinks a valid PNG that is over the 5 MB limit to a JPEG WhatsApp will take (the 7.6 MB image that failed in production)', async () => {
    const big = makeOversizedPng();
    expect(big.length).toBeGreaterThan(WHATSAPP_IMAGE_MAX_BYTES);
    const { service, logger } = build();
    await service.uploadMediaToMeta('t1', big, 'image/png', 'media.png');
    const form = (axios.post as jest.Mock).mock.calls[0][1] as { getBuffer: () => Buffer };
    expect(uploaded()).toMatchObject({ filename: 'media.jpg', contentType: 'image/jpeg', firstBytes: [0xff, 0xd8, 0xff, expect.any(Number)] });
    expect(form.getBuffer().length).toBeLessThan(WHATSAPP_IMAGE_MAX_BYTES + 1000); // the multipart part headers are a few hundred bytes
    expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/Uploading media to Meta: image\/jpeg, \d+ bytes, as media\.jpg \(received image\/png, \d+ bytes\)/));
  });

  it('sends a PNG under the limit unchanged, keeping its transparency', async () => {
    const { service } = build();
    await service.uploadMediaToMeta('t1', PNG, 'image/png', 'media.png');
    expect(uploaded()).toMatchObject({ filename: 'media.png', contentType: 'image/png' });
  });

  it('does not touch a document', async () => {
    const { service } = build();
    await service.uploadMediaToMeta('t1', Buffer.from('%PDF-1.4 x'), 'application/pdf', 'media.pdf');
    expect(uploaded()).toMatchObject({ filename: 'media.pdf', contentType: 'application/pdf' });
  });

  it('uploads an unreadable image as it is and says why, so Meta gives the real error', async () => {
    const { service, logger } = build();
    await service.uploadMediaToMeta('t1', Buffer.from('not really an image'), 'image/webp', 'media.webp');
    expect(uploaded()).toMatchObject({ filename: 'media.webp', contentType: 'image/webp' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('image conversion failed'));
  });
});
