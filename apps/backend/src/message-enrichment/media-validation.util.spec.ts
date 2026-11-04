import { DEFAULT_LIMITS, sniffAudio, sniffImage, validateAudio, validateImage } from './media-validation.util';

const pad = (head: Buffer, total = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 1)]);
const ascii = (s: string) => Buffer.from(s, 'latin1');

export const AUDIO_SAMPLES: Record<string, Buffer> = {
  ogg: pad(Buffer.concat([ascii('OggS'), Buffer.alloc(8)])),
  mp3_id3: pad(Buffer.concat([ascii('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0])])),
  mp3_frame: pad(Buffer.from([0xff, 0xfb, 0x90, 0x00])),
  wav: pad(Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE')])),
  m4a: pad(Buffer.concat([Buffer.alloc(4), ascii('ftypM4A '), Buffer.alloc(4)])),
  webm: pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])),
  flac: pad(Buffer.concat([ascii('fLaC'), Buffer.alloc(8)])),
  amr: pad(ascii('#!AMR\n12345')),
  aac: pad(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])),
};

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number): Buffer {
  // SOI, APP0 (16 bytes), SOF0 with the size, then padding
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), ascii('JFIF\0'), Buffer.alloc(9)]);
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([soi, app0, sof, Buffer.alloc(8)]);
}
function gif(w: number, h: number): Buffer { const b = Buffer.alloc(20); b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; }
function webpX(w: number, h: number): Buffer {
  const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
}
export const IMAGE_SAMPLES = { png, jpeg, gif, webpX };

describe('sniffAudio / validateAudio', () => {
  it.each([
    ['ogg', 'ogg', true], ['mp3_id3', 'mp3', true], ['mp3_frame', 'mp3', true], ['wav', 'wav', true], ['m4a', 'm4a', true], ['webm', 'webm', true], ['flac', 'flac', true],
    ['amr', 'amr', false], ['aac', 'aac', false],
  ])('recognises %s by its bytes (providerReadable=%s needs conversion when false)', (sample, kind, readable) => {
    const info = sniffAudio(AUDIO_SAMPLES[sample]!)!;
    expect(info.kind).toBe(kind);
    expect(info.providerReadable).toBe(readable);
  });
  it('rejects empty, too-small, text, image and truncated input', () => {
    expect(validateAudio(Buffer.alloc(0))).toEqual({ ok: false, code: 'empty' });
    expect(validateAudio(Buffer.from('hello'))).toEqual({ ok: false, code: 'unsupported_format' });
    expect(validateAudio(ascii('<html>not audio at all, really</html>'))).toEqual({ ok: false, code: 'unsupported_format' });
    expect(validateAudio(png(100, 100))).toEqual({ ok: false, code: 'unsupported_format' });
    expect(validateAudio(Buffer.alloc(64, 0))).toEqual({ ok: false, code: 'unsupported_format' });
  });
  it('enforces the size limit before anything else', () => {
    const big = Buffer.concat([AUDIO_SAMPLES['ogg']!, Buffer.alloc(DEFAULT_LIMITS.audioMaxBytes)]);
    expect(validateAudio(big)).toEqual({ ok: false, code: 'too_large' });
  });
  it('judges the bytes, not a claimed type: an image renamed .ogg is not audio', () => {
    expect(sniffAudio(jpeg(100, 100))).toBeNull();
  });
});

describe('sniffImage / validateImage', () => {
  it.each([
    ['png', png(640, 480), 'image/png', 640, 480], ['jpeg', jpeg(1024, 768), 'image/jpeg', 1024, 768], ['gif', gif(200, 100), 'image/gif', 200, 100], ['webp', webpX(800, 600), 'image/webp', 800, 600],
  ])('reads %s type and size from the header', (_n, buf, mime, w, h) => {
    expect(sniffImage(buf)).toMatchObject({ mime, width: w, height: h });
    expect(validateImage(buf).ok).toBe(true);
  });
  it('refuses unsupported, corrupt, empty and oversize files', () => {
    expect(validateImage(Buffer.alloc(0))).toEqual({ ok: false, code: 'empty' });
    expect(validateImage(ascii('GIF89a-this-is-text-not-a-gif-really'))).toEqual({ ok: false, code: 'bad_dimensions' });   // text posing as a GIF decodes to absurd dimensions
    expect(validateImage(AUDIO_SAMPLES['ogg']!)).toEqual({ ok: false, code: 'unsupported_format' });
    expect(validateImage(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 40))).toEqual({ ok: false, code: 'unsupported_format' });   // JPEG with no frame header: truncated
    expect(validateImage(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 40))).toEqual({ ok: false, code: 'unsupported_format' });    // PNG without IHDR
    expect(validateImage(Buffer.concat([png(100, 100), Buffer.alloc(DEFAULT_LIMITS.imageMaxBytes)]))).toEqual({ ok: false, code: 'too_large' });
  });
  it('refuses absurd dimensions (decompression bombs) and thumbnails too small to describe', () => {
    expect(validateImage(png(100_000, 100_000))).toEqual({ ok: false, code: 'bad_dimensions' });
    expect(validateImage(png(8001, 100))).toEqual({ ok: false, code: 'bad_dimensions' });
    expect(validateImage(png(7000, 7000))).toEqual({ ok: false, code: 'bad_dimensions' });      // 49 MP
    expect(validateImage(png(8, 8))).toEqual({ ok: false, code: 'bad_dimensions' });
    expect(validateImage(png(0, 0))).toEqual({ ok: false, code: 'bad_dimensions' });
  });
});
