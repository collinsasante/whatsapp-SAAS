/**
 * Validation of customer media before it is sent to a third-party provider. The declared MIME type of an upload is whatever the sender (or a sender's
 * client) claimed, so nothing is believed until the bytes agree: a file is judged by its own header. Pure; no I/O.
 */
export type AudioKind = 'ogg' | 'mp3' | 'wav' | 'm4a' | 'webm' | 'flac' | 'amr' | 'aac';
export interface AudioInfo { kind: AudioKind; mime: string; ext: string; /** The provider reads this container directly; otherwise it must be converted first. */ providerReadable: boolean }

const AUDIO: Record<AudioKind, Omit<AudioInfo, 'kind'>> = {
  ogg: { mime: 'audio/ogg', ext: 'ogg', providerReadable: true },
  mp3: { mime: 'audio/mpeg', ext: 'mp3', providerReadable: true },
  wav: { mime: 'audio/wav', ext: 'wav', providerReadable: true },
  m4a: { mime: 'audio/mp4', ext: 'm4a', providerReadable: true },
  webm: { mime: 'audio/webm', ext: 'webm', providerReadable: true },
  flac: { mime: 'audio/flac', ext: 'flac', providerReadable: true },
  amr: { mime: 'audio/amr', ext: 'amr', providerReadable: false },
  aac: { mime: 'audio/aac', ext: 'aac', providerReadable: false },
};

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

export function sniffAudio(b: Buffer): AudioInfo | null {
  if (b.length < 12) return null;
  let kind: AudioKind | null = null;
  if (ascii(b, 0, 4) === 'OggS') kind = 'ogg';
  else if (ascii(b, 0, 4) === 'fLaC') kind = 'flac';
  else if (ascii(b, 0, 5) === '#!AMR') kind = 'amr';
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') kind = 'wav';
  else if (ascii(b, 4, 8) === 'ftyp') kind = 'm4a';                                          // mp4 / m4a / 3gp family
  else if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) kind = 'webm';
  else if (ascii(b, 0, 3) === 'ID3') kind = 'mp3';
  else if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) kind = (b[1]! & 0x06) === 0 ? 'aac' : 'mp3';  // frame sync: layer bits 00 = ADTS AAC
  return kind ? { kind, ...AUDIO[kind] } : null;
}

export type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp';
export interface ImageInfo { kind: ImageKind; mime: string; width?: number; height?: number }

export function sniffImage(b: Buffer): ImageInfo | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'jpeg', mime: 'image/jpeg', ...jpegSize(b) };
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return { kind: 'png', mime: 'image/png', ...(ascii(b, 12, 16) === 'IHDR' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : {}) };
  if (ascii(b, 0, 3) === 'GIF') return { kind: 'gif', mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'webp', mime: 'image/webp', ...webpSize(b) };
  return null;
}

function jpegSize(b: Buffer): { width?: number; height?: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return {};
    // start-of-frame markers carry the size (C4, C8 and CC are not frames)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return {};
}

function webpSize(b: Buffer): { width?: number; height?: number } {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  return {};
}

export interface MediaLimits {
  audioMaxBytes: number; imageMaxBytes: number; imageMaxSide: number; imageMinSide: number; imageMaxPixels: number;
}
export const DEFAULT_LIMITS: MediaLimits = { audioMaxBytes: 10 * 1024 * 1024, imageMaxBytes: 10 * 1024 * 1024, imageMaxSide: 8000, imageMinSide: 16, imageMaxPixels: 40_000_000 };

export type Verdict<T> = { ok: true; info: T } | { ok: false; code: 'empty' | 'too_large' | 'unsupported_format' | 'bad_dimensions' };

export function validateAudio(buffer: Buffer, limits: MediaLimits = DEFAULT_LIMITS): Verdict<AudioInfo> {
  if (buffer.length === 0) return { ok: false, code: 'empty' };
  if (buffer.length > limits.audioMaxBytes) return { ok: false, code: 'too_large' };
  const info = sniffAudio(buffer);
  return info ? { ok: true, info } : { ok: false, code: 'unsupported_format' };
}

export function validateImage(buffer: Buffer, limits: MediaLimits = DEFAULT_LIMITS): Verdict<ImageInfo> {
  if (buffer.length === 0) return { ok: false, code: 'empty' };
  if (buffer.length > limits.imageMaxBytes) return { ok: false, code: 'too_large' };
  const info = sniffImage(buffer);
  if (!info) return { ok: false, code: 'unsupported_format' };
  const { width, height } = info;
  if (width !== undefined && height !== undefined) {
    if (width < limits.imageMinSide || height < limits.imageMinSide || width > limits.imageMaxSide || height > limits.imageMaxSide || width * height > limits.imageMaxPixels) {
      return { ok: false, code: 'bad_dimensions' };
    }
  } else if (info.kind !== 'webp') {
    // A JPEG/PNG/GIF whose header we cannot read is truncated or corrupt.
    return { ok: false, code: 'unsupported_format' };
  }
  return { ok: true, info };
}
