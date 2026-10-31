import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isJpegBuffer, isPngBuffer, needsImageTranscode, sniffImageKind, transcodeImageToJpeg, WHATSAPP_IMAGE_MAX_BYTES } from './image.util';
import { makeOversizedPng } from './image.test-helpers';

// real ffmpeg transcodes of a multi-megabyte image; slow when the suite runs in parallel, so the default 5 s limit is too tight.
jest.setTimeout(30_000);

// Tiny real files: a 1x1 lossy WebP, a 1x1 fully transparent lossless WebP, a 1x1 GIF, and a 1x1 PNG.
const LOSSY_WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const TRANSPARENT_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

describe('image signatures', () => {
  it('recognises JPEG and PNG by their first bytes, and nothing else', () => {
    expect(isJpegBuffer(JPEG)).toBe(true);
    expect(isPngBuffer(PNG)).toBe(true);
    for (const other of [LOSSY_WEBP, TRANSPARENT_WEBP, GIF, Buffer.alloc(0), Buffer.from('hello')]) {
      expect(isJpegBuffer(other)).toBe(false);
      expect(isPngBuffer(other)).toBe(false);
    }
  });
});

describe('needsImageTranscode', () => {
  it('leaves real JPEG and PNG alone', () => {
    expect(needsImageTranscode('image/jpeg', JPEG)).toBe(false);
    expect(needsImageTranscode('image/png', PNG)).toBe(false);
  });

  it('converts WebP and GIF, which WhatsApp does not accept as images', () => {
    expect(needsImageTranscode('image/webp', LOSSY_WEBP)).toBe(true);
    expect(needsImageTranscode('image/gif', GIF)).toBe(true);
  });

  it('trusts the bytes, not the declared type', () => {
    expect(needsImageTranscode('image/jpeg', LOSSY_WEBP)).toBe(true);
    expect(needsImageTranscode('image/webp', JPEG)).toBe(false);
  });

  it('ignores anything that is not an image', () => {
    expect(needsImageTranscode('application/pdf', Buffer.from('%PDF'))).toBe(false);
    expect(needsImageTranscode('video/mp4', Buffer.from('x'))).toBe(false);
  });
});

describe('transcodeImageToJpeg (real ffmpeg)', () => {
  it.each([['WebP', LOSSY_WEBP], ['GIF', GIF], ['transparent WebP', TRANSPARENT_WEBP]])('turns a %s into a JPEG that needs no further conversion', async (_name, input) => {
    const out = await transcodeImageToJpeg(input);
    expect(isJpegBuffer(out)).toBe(true);
    expect(needsImageTranscode('image/jpeg', out)).toBe(false);
  });

  it('flattens transparency onto white, not black', async () => {
    const out = await transcodeImageToJpeg(TRANSPARENT_WEBP);
    // Decode the JPEG's only pixel back with ffmpeg and read it as RGB.
    const { execFileSync } = await import('child_process');
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: out });
    expect([...rgb]).toEqual([255, 255, 255]);
  });

  it('rejects input that is not an image, and leaves no temporary files behind', async () => {
    // A private temp folder, so another test file converting images at the same moment cannot add files to what is being counted.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-test-'));
    const spy = jest.spyOn(os, 'tmpdir').mockReturnValue(dir);
    try {
      await expect(transcodeImageToJpeg(Buffer.from('this is not an image'))).rejects.toBeDefined();
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sniffImageKind', () => {
  it('reports what the bytes are, whatever the file was called', () => {
    expect(sniffImageKind(JPEG)).toBe('jpeg');
    expect(sniffImageKind(PNG)).toBe('png');
    expect(sniffImageKind(LOSSY_WEBP)).toBe('webp');
    expect(sniffImageKind(TRANSPARENT_WEBP)).toBe('webp');
    expect(sniffImageKind(GIF)).toBe('gif');
    expect(sniffImageKind(Buffer.from('<svg/>'))).toBe('other');
    expect(sniffImageKind(Buffer.alloc(0))).toBe('other');
  });
});

/** Width and height from the JPEG's start-of-frame marker. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no frame header');
}

describe('images over the WhatsApp size limit', () => {
  const big = makeOversizedPng();

  it('the fixture is a real PNG over the limit, like the file WhatsApp refused', () => {
    expect(isPngBuffer(big)).toBe(true);
    expect(big.length).toBeGreaterThan(WHATSAPP_IMAGE_MAX_BYTES);
  });

  it('needs conversion although it is a valid PNG, while a small PNG and a small JPEG do not', () => {
    expect(needsImageTranscode('image/png', big)).toBe(true);
    expect(needsImageTranscode('image/png', PNG)).toBe(false);
    expect(needsImageTranscode('image/jpeg', Buffer.concat([JPEG, Buffer.alloc(WHATSAPP_IMAGE_MAX_BYTES)]))).toBe(true);
  });

  it('becomes a JPEG under the limit at its full resolution when that already fits', async () => {
    const out = await transcodeImageToJpeg(big);
    expect(isJpegBuffer(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(WHATSAPP_IMAGE_MAX_BYTES);
    expect(jpegSize(out)).toEqual({ width: 2400, height: 1800 });
  });

  it('shrinks further, keeping the proportions, when the limit is tighter', async () => {
    const limit = 1_200_000;
    const out = await transcodeImageToJpeg(big, limit);
    expect(isJpegBuffer(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(limit);
    const { width, height } = jpegSize(out);
    expect(width).toBeLessThan(2400);
    expect(Math.abs(width / height - 2400 / 1800)).toBeLessThan(0.02);
  });

  it('returns the smallest result it could make, not an error, when nothing fits', async () => {
    const out = await transcodeImageToJpeg(big, 1_000);
    expect(isJpegBuffer(out)).toBe(true);
    expect(out.length).toBeLessThan(big.length);
  });

  it('does not enlarge a small image', async () => {
    expect(jpegSize(await transcodeImageToJpeg(LOSSY_WEBP))).toEqual({ width: 1, height: 1 });
  });
});
