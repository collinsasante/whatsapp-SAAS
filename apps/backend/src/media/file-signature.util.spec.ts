import { contentMatchesDeclaredType } from './file-signature.util';
import { MIME_TO_MEDIA_TYPE } from './media.service';

const b = (...bytes: number[]) => Buffer.from(bytes);
const ftyp = (brand: string) => Buffer.concat([b(0, 0, 0, 0x18), Buffer.from('ftyp' + brand)]);

const VALID: Record<string, Buffer> = {
  'image/jpeg': b(0xff, 0xd8, 0xff, 0xdb),
  'image/png': b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/gif': Buffer.from('GIF89a....'),
  'image/webp': Buffer.concat([Buffer.from('RIFF'), b(0, 0, 0, 0), Buffer.from('WEBPVP8 ')]),
  'video/mp4': ftyp('isom'),
  'video/quicktime': ftyp('qt  '),
  'video/3gpp': ftyp('3gp4'),
  'video/webm': b(0x1a, 0x45, 0xdf, 0xa3, 1),
  'audio/webm': b(0x1a, 0x45, 0xdf, 0xa3, 1),
  'audio/ogg': Buffer.from('OggS\0'),
  'audio/wav': Buffer.concat([Buffer.from('RIFF'), b(0, 0, 0, 0), Buffer.from('WAVEfmt ')]),
  'audio/mp4': ftyp('M4A '),
  'audio/x-m4a': ftyp('M4A '),
  'audio/m4a': ftyp('M4A '),
  'audio/mpeg': Buffer.from('ID3\x04\0'),
  'audio/aac': b(0xff, 0xf1, 0x50, 0x80),
  'audio/amr': Buffer.from('#!AMR\n'),
  'application/pdf': Buffer.from('%PDF-1.4\n'),
  'application/msword': b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
  'application/vnd.ms-excel': b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': b(0x50, 0x4b, 0x03, 0x04),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': b(0x50, 0x4b, 0x03, 0x04),
  'text/plain': Buffer.from('Hello, this is a note.\nSecond line.'),
};

describe('contentMatchesDeclaredType', () => {
  it('has a valid sample for every type on the upload allowlist (a new type cannot be added unchecked)', () => {
    expect(Object.keys(VALID).sort()).toEqual(Object.keys(MIME_TO_MEDIA_TYPE).sort());
  });

  it.each(Object.entries(VALID))('accepts genuine %s content', (mime, bytes) => {
    expect(contentMatchesDeclaredType(mime, bytes)).toBe(true);
  });

  it('accepts MP3 frames without an ID3 tag and a PDF whose header is preceded by a few bytes', () => {
    expect(contentMatchesDeclaredType('audio/mpeg', b(0xff, 0xfb, 0x90, 0x00))).toBe(true);
    expect(contentMatchesDeclaredType('application/pdf', Buffer.from('\n\n%PDF-1.5\n'))).toBe(true);
  });

  it('accepts AAC carried in an MP4 container', () => {
    expect(contentMatchesDeclaredType('audio/aac', ftyp('M4A '))).toBe(true);
  });

  it('rejects empty and missing content for every type', () => {
    for (const mime of Object.keys(VALID)) {
      expect(contentMatchesDeclaredType(mime, Buffer.alloc(0))).toBe(false);
      expect(contentMatchesDeclaredType(mime, undefined)).toBe(false);
    }
  });

  it('rejects a type that is not on the allowlist, whatever the bytes', () => {
    expect(contentMatchesDeclaredType('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
    expect(contentMatchesDeclaredType('text/html', Buffer.from('<html>'))).toBe(false);
  });

  it('rejects every sample presented under a different signature family', () => {
    const wrong: Array<[string, Buffer]> = [
      ['image/png', VALID['image/jpeg']!],
      ['image/jpeg', VALID['application/pdf']!],
      ['application/pdf', VALID['image/png']!],
      ['audio/ogg', VALID['audio/wav']!],
      ['video/mp4', VALID['video/webm']!],
      ['audio/webm', VALID['audio/ogg']!],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', VALID['application/pdf']!],
    ];
    for (const [mime, bytes] of wrong) expect(contentMatchesDeclaredType(mime, bytes)).toBe(false);
  });

  describe('text/plain', () => {
    it.each([
      ['HTML', '<!DOCTYPE html><html></html>'],
      ['HTML after whitespace', '   \n  <script>alert(1)</script>'],
      ['an XML/SVG prolog', '<?xml version="1.0"?><svg/>'],
      ['a Windows executable', 'MZ\u0090\u0000'],
      ['an ELF binary', '\u007fELF\u0002'],
      ['a shell script', '#!/bin/sh\nrm -rf /'],
      ['binary data with NUL bytes', 'abc\u0000def'],
    ])('rejects %s', (_label, text) => {
      expect(contentMatchesDeclaredType('text/plain', Buffer.from(text, 'latin1'))).toBe(false);
    });

    it('accepts UTF-8 text with non-ASCII characters', () => {
      expect(contentMatchesDeclaredType('text/plain', Buffer.from('Café — 你好 😀'))).toBe(true);
    });
  });
});
