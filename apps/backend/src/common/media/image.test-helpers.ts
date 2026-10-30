import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A real, valid 8-bit RGB PNG of random noise: incompressible, so 2400x1800 is over 6 MB, like the 7.6 MB PNG WhatsApp refused. */
export function makeOversizedPng(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigpng-'));
  const file = path.join(dir, 'big.png');
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', "nullsrc=s=2400x1800,format=rgb24,geq=r='random(1)*255':g='random(1)*255':b='random(1)*255'", '-frames:v', '1', file]);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
