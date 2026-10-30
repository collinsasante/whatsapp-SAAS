import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** JPEG files start with FF D8 FF. */
export function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** PNG files start with 89 "PNG" 0D 0A 1A 0A. */
export function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.toString('latin1', 1, 4) === 'PNG' && buf[0] === 0x89 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

/** What the bytes really are, for diagnostics: the declared type of an upload can be wrong. */
export function sniffImageKind(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | 'other' {
  if (isJpegBuffer(buf)) return 'jpeg';
  if (isPngBuffer(buf)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return 'other';
}

/**
 * WhatsApp Cloud accepts only JPEG and PNG as an image message. The platform also stores WebP and GIF as images, and a declared
 * type can be wrong, so the decision is made on the file signature: anything labelled image/* that is not really JPEG or PNG
 * has to be converted before it is sent.
 */
export function needsImageTranscode(mimeType: string, buf: Buffer): boolean {
  return mimeType.toLowerCase().startsWith('image/') && !isJpegBuffer(buf) && !isPngBuffer(buf);
}

/**
 * Converts any still image ffmpeg can read (WebP, GIF, AVIF...) to JPEG: first frame only, transparency flattened onto white
 * (JPEG has none, and black behind a product photo looks like a defect). Arguments are passed without a shell.
 */
export async function transcodeImageToJpeg(buffer: Buffer): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = os.tmpdir();
  const inputPath = path.join(dir, `img_in_${id}`);
  const outputPath = path.join(dir, `img_out_${id}.jpg`);
  try {
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync('ffmpeg', [
      '-y', '-v', 'error', '-i', inputPath, '-frames:v', '1',
      '-filter_complex', '[0:v]format=rgba,split[fg][bg];[bg]drawbox=x=0:y=0:w=iw:h=ih:c=white:t=fill[w];[w][fg]overlay=format=auto,format=yuvj420p',
      '-q:v', '2', '-f', 'mjpeg', outputPath,
    ], { timeout: 30_000 });
    const out = fs.readFileSync(outputPath);
    if (!isJpegBuffer(out)) throw new Error('ffmpeg did not produce a JPEG file');
    return out;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}
