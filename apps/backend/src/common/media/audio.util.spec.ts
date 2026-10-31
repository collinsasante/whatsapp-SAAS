import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isOggBuffer, isWebmBuffer, transcodeWebmToOgg } from './audio.util';

// real ffmpeg remux; slow when the suite runs in parallel, so the default 5 s limit is too tight.
jest.setTimeout(30_000);

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const describeReal = hasFfmpeg ? describe : describe.skip;

describe('container sniffing', () => {
  it('recognises WebM (EBML) and Ogg ("OggS") by magic bytes, and nothing else', () => {
    expect(isWebmBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toBe(true);
    expect(isOggBuffer(Buffer.from('OggS\u0000\u0002'))).toBe(true);
    expect(isWebmBuffer(Buffer.from('OggS'))).toBe(false);
    expect(isOggBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
    for (const tiny of [Buffer.alloc(0), Buffer.from([1, 2])]) {
      expect(isWebmBuffer(tiny)).toBe(false);
      expect(isOggBuffer(tiny)).toBe(false);
    }
  });
});

// Uses the real ffmpeg binary and a real recording-shaped file, not a mock.
describeReal('transcodeWebmToOgg (real ffmpeg)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'));
  const webmPath = path.join(tmp, 'voice-note.webm');
  let webm: Buffer;

  beforeAll(() => {
    // A 1.5s 440 Hz tone encoded as Opus in WebM: the same container and codec Chrome's MediaRecorder produces.
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'libopus', '-b:a', '32k', webmPath]);
    webm = fs.readFileSync(webmPath);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString()) as {
    format: { format_name: string; duration: string };
    streams: Array<{ codec_name: string; codec_type: string }>;
  };

  it('the input really is WebM/Opus (the test fixture is faithful)', () => {
    expect(isWebmBuffer(webm)).toBe(true);
    const info = probe(webmPath);
    expect(info.format.format_name).toContain('webm');
    expect(info.streams[0]).toMatchObject({ codec_type: 'audio', codec_name: 'opus' });
  });

  it('produces a genuine OGG/Opus file of the same length, without re-encoding', async () => {
    const ogg = await transcodeWebmToOgg(webm);
    expect(isOggBuffer(ogg)).toBe(true);
    const outPath = path.join(tmp, 'out.ogg');
    fs.writeFileSync(outPath, ogg);
    const info = probe(outPath);
    expect(info.format.format_name).toBe('ogg');
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toEqual([expect.objectContaining({ codec_name: 'opus' })]);
    expect(Math.abs(Number(info.format.duration) - 1.5)).toBeLessThan(0.2);
    // and it decodes cleanly end to end
    expect(spawnSync('ffmpeg', ['-v', 'error', '-i', outPath, '-f', 'null', '-']).stderr.toString()).toBe('');
  });

  it('rejects input that is not audio, and leaves no temporary files behind', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('wa_')).length;
    await expect(transcodeWebmToOgg(Buffer.from('this is definitely not a webm file'))).rejects.toThrow();
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('wa_')).length;
    expect(after).toBe(before);
  });
});

describe('Messenger/Instagram audio', () => {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isMetaPlayableAudio, transcodeToM4a } = require('./audio.util') as typeof import('./audio.util');

  it('recognises what Meta can play by file signature, and rejects what it cannot', () => {
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(16)]);
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);
    const adts = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(12)]);
    expect([m4a, wav, adts].map(isMetaPlayableAudio)).toEqual([true, true, true]);
    expect([webm, ogg, Buffer.alloc(0), Buffer.from('hello world, not audio')].map(isMetaPlayableAudio)).toEqual([false, false, false, false]);
  });

  (hasFfmpeg ? it : it.skip)('converts a real browser-style WebM/Opus voice note into playable M4A', async () => {
    const dir = require('os').tmpdir() as string;
    const webmPath = `${dir}/verz_test_${process.pid}.webm`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', webmPath]);
    const webm = require('fs').readFileSync(webmPath) as Buffer;
    require('fs').unlinkSync(webmPath);
    expect(isMetaPlayableAudio(webm)).toBe(false);

    const m4a = await transcodeToM4a(webm);

    expect(isMetaPlayableAudio(m4a)).toBe(true);
    expect(m4a.length).toBeGreaterThan(1000);
  });

  (hasFfmpeg ? it : it.skip)('rejects input that is not audio instead of returning garbage', async () => {
    await expect(transcodeToM4a(Buffer.from('this is not audio'))).rejects.toBeDefined();
  });
});
