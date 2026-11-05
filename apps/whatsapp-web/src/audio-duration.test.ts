import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAudioDuration } from '@whiskeysockets/baileys';

// Baileys measures the duration of every outbound audio message with music-metadata. The installed copy is patched
// (patches/@whiskeysockets__baileys@*.patch) to load the ESM-only, security-fixed music-metadata 11.x. If that patch
// stops applying, or the override is dropped, these fail instead of the first voice note in production.

function ffmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = ffmpegAvailable();

function makeTone(dir: string, name: string, args: string[]): Buffer {
  const out = join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...args, '-y', out]);
  return readFileSync(out);
}

test('getAudioDuration reads real MP3 and OGG/Opus buffers (the formats the product sends)', { skip: !HAS_FFMPEG && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audio-duration-'));
  try {
    const mp3 = makeTone(dir, 'tone.mp3', ['-c:a', 'libmp3lame']);
    const ogg = makeTone(dir, 'tone.ogg', ['-c:a', 'libopus']);
    for (const [label, buf] of [['mp3', mp3], ['ogg/opus', ogg]] as const) {
      const seconds = await getAudioDuration(buf);
      assert.ok(typeof seconds === 'number' && Math.abs(seconds - 2) < 0.3, `${label} duration was ${seconds}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hostile or garbage bytes fail fast instead of hanging the process', async () => {
  // ASF header GUID followed by a zero-length object: the shape behind the music-metadata ASF infinite-loop advisories.
  const asf = Buffer.concat([
    Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex'),
    Buffer.alloc(8),
    Buffer.alloc(64),
  ]);
  const garbage = Buffer.alloc(4096, 0xff);
  for (const [label, buf] of [['asf', asf], ['garbage', garbage]] as const) {
    const started = Date.now();
    await Promise.race([
      getAudioDuration(buf).catch(() => undefined),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} parse did not return within 5s`)), 5000).unref()),
    ]);
    assert.ok(Date.now() - started < 5000);
  }
});
