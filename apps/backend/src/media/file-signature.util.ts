/**
 * Checks that an uploaded file's leading bytes agree with the type the client declared. The upload allowlist in
 * media.service.ts is keyed on the declared MIME type alone, which the client controls: without this, markup or an
 * executable renamed "image/png", or a crafted container declared "audio/ogg", would be stored, served and handed to
 * parsers (ffmpeg, music-metadata, thumbnailing) as if it were what it claimed.
 *
 * Deliberately conservative: a type is rejected only when its signature is known and absent. Formats without a
 * reliable magic number (raw ADTS/MP3 frames, AMR variants, plain text) are accepted unless they positively look like
 * something else, so legitimate recordings from phones and browsers are never turned away.
 */

type Signature = (buf: Buffer) => boolean;

const startsWith = (...bytes: number[]): Signature => (buf) => bytes.every((b, i) => buf[i] === b);
const ascii = (buf: Buffer, offset: number, text: string): boolean => buf.length >= offset + text.length && buf.toString('latin1', offset, offset + text.length) === text;

const isIsoBaseMedia: Signature = (buf) => ascii(buf, 4, 'ftyp');
const isZip: Signature = (buf) => startsWith(0x50, 0x4b, 0x03, 0x04)(buf) || startsWith(0x50, 0x4b, 0x05, 0x06)(buf);
const isOleCompound: Signature = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const isMp3: Signature = (buf) =>
  ascii(buf, 0, 'ID3') || (buf.length > 1 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0);
const isAdts: Signature = (buf) => buf.length > 1 && buf[0] === 0xff && (buf[1]! & 0xf6) === 0xf0;

const SIGNATURES: Record<string, Signature> = {
  'image/jpeg': startsWith(0xff, 0xd8, 0xff),
  'image/png': startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/gif': (buf) => ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a'),
  'image/webp': (buf) => ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP'),
  'video/mp4': isIsoBaseMedia,
  'video/quicktime': isIsoBaseMedia,
  'video/3gpp': isIsoBaseMedia,
  'video/webm': startsWith(0x1a, 0x45, 0xdf, 0xa3),
  'audio/webm': startsWith(0x1a, 0x45, 0xdf, 0xa3),
  'audio/ogg': (buf) => ascii(buf, 0, 'OggS'),
  'audio/wav': (buf) => ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WAVE'),
  'audio/mp4': isIsoBaseMedia,
  'audio/x-m4a': isIsoBaseMedia,
  'audio/m4a': isIsoBaseMedia,
  'audio/mpeg': isMp3,
  // AAC is carried as raw ADTS frames or inside an MP4 container.
  'audio/aac': (buf) => isAdts(buf) || isIsoBaseMedia(buf),
  'audio/amr': (buf) => ascii(buf, 0, '#!AMR'),
  'application/pdf': (buf) => ascii(buf, 0, '%PDF-') || buf.subarray(0, 1024).includes('%PDF-'),
  'application/msword': isOleCompound,
  'application/vnd.ms-excel': isOleCompound,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
};

/** Bytes that begin markup or an executable: never acceptable for a type without its own signature. */
function looksLikeMarkupOrExecutable(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString('latin1').trimStart().toLowerCase();
  return (
    head.startsWith('<') ||
    head.startsWith('mz') ||
    head.startsWith('\x7felf') ||
    head.startsWith('#!') ||
    head.startsWith('%!ps')
  );
}

function isPlainText(buf: Buffer): boolean {
  if (looksLikeMarkupOrExecutable(buf)) return false;
  // Binary content has NUL bytes; text never does.
  return !buf.subarray(0, 8192).includes(0);
}

/** True when the file's content is consistent with the declared (already normalised) MIME type. */
export function contentMatchesDeclaredType(mimeType: string, buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.length === 0) return false;
  if (mimeType === 'text/plain') return isPlainText(buffer);
  const signature = SIGNATURES[mimeType];
  if (!signature) return false;
  return signature(buffer);
}
