import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** WebM files start with the EBML magic bytes 0x1A 0x45 0xDF 0xA3. */
export function isWebmBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

/** Ogg files start with "OggS". */
export function isOggBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS';
}

/**
 * Remuxes Opus audio from a WebM container into an OGG container. No re-encoding, so it is instant and lossless.
 * Browsers record voice notes as WebM/Opus; WhatsApp (Cloud API and the linked-device protocol) wants OGG/Opus.
 * Arguments are passed without a shell, so file names can never be interpreted as commands.
 */
export async function transcodeWebmToOgg(buffer: Buffer): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = os.tmpdir();
  const inputPath = path.join(dir, `wa_in_${id}.webm`);
  const outputPath = path.join(dir, `wa_out_${id}.ogg`);
  try {
    fs.writeFileSync(inputPath, buffer);
    await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', inputPath, '-vn', '-c:a', 'copy', '-f', 'ogg', outputPath], { timeout: 30_000 });
    const out = fs.readFileSync(outputPath);
    if (!isOggBuffer(out)) throw new Error('ffmpeg did not produce an OGG file');
    return out;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}
