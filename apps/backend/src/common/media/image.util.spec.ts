import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isJpegBuffer, isPngBuffer, needsImageTranscode, sniffImageKind, transcodeImageToJpeg } from './image.util';

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
