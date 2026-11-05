import { PassThrough } from 'stream';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MAX_UPLOAD_BYTES, maxBytesForMime, mediaFileFilter, sizeLimitedMemoryStorage } from './upload-limits';
import { MIME_TO_MEDIA_TYPE } from './media.service';

const MB = 1024 * 1024;

function filterResult(mimetype: string): { error: Error | null; accepted?: boolean } {
  let out: { error: Error | null; accepted?: boolean } = { error: null };
  mediaFileFilter({} as never, { mimetype } as Express.Multer.File, (error, accepted) => { out = { error, accepted }; });
  return out;
}

function handle(mimetype: string, chunks: Buffer[]): Promise<{ error?: Error; info?: { buffer?: Buffer; size?: number } }> {
  return new Promise((resolve) => {
    const stream = new PassThrough();
    sizeLimitedMemoryStorage()._handleFile({} as never, { mimetype, stream } as never, (error, info) => resolve({ error: error as Error | undefined, info: info as never }));
    for (const c of chunks) stream.write(c);
    stream.end();
  });
}

describe('upload size ceilings', () => {
  it('gives every allowlisted type a ceiling, with video the largest', () => {
    for (const mime of Object.keys(MIME_TO_MEDIA_TYPE)) expect(maxBytesForMime(mime)).toBeGreaterThan(0);
    expect(maxBytesForMime('video/mp4')).toBe(MAX_UPLOAD_BYTES.VIDEO);
    expect(maxBytesForMime('image/png')).toBe(16 * MB);
    expect(maxBytesForMime('application/pdf')).toBe(100 * MB);
    expect(maxBytesForMime('audio/ogg; codecs=opus')).toBe(64 * MB);
  });

  it('has no ceiling for an unlisted type', () => {
    expect(maxBytesForMime('text/html')).toBeUndefined();
    expect(maxBytesForMime('')).toBeUndefined();
  });
});

describe('mediaFileFilter', () => {
  it('rejects a disallowed declared type before the body is read', () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/x-msdownload', '']) {
      const r = filterResult(mime);
      expect(r.error).toBeInstanceOf(BadRequestException);
      expect(r.accepted).toBe(false);
    }
  });

  it('accepts an allowed type, including a parameterised one', () => {
    expect(filterResult('image/png')).toEqual({ error: null, accepted: true });
    expect(filterResult('audio/webm;codecs=opus')).toEqual({ error: null, accepted: true });
  });
});

describe('sizeLimitedMemoryStorage', () => {
  it('buffers a file within its ceiling and reports its size', async () => {
    const { error, info } = await handle('image/png', [Buffer.alloc(1024, 1), Buffer.alloc(1024, 2)]);
    expect(error).toBeFalsy();
    expect(info?.size).toBe(2048);
    expect(info?.buffer?.length).toBe(2048);
  });

  it('aborts with 413 as soon as an image passes 16 MB, without buffering the rest', async () => {
    const chunk = Buffer.alloc(MB, 1);
    const { error, info } = await handle('image/png', Array.from({ length: 20 }, () => chunk));
    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(info).toBeUndefined();
  });

  it('allows the same size for video, which has the larger ceiling', async () => {
    const chunk = Buffer.alloc(MB, 1);
    const { error, info } = await handle('video/mp4', Array.from({ length: 20 }, () => chunk));
    expect(error).toBeFalsy();
    expect(info?.size).toBe(20 * MB);
  });

  it('a file of exactly the ceiling passes and one byte over fails', async () => {
    const limit = 16 * MB;
    expect((await handle('image/png', [Buffer.alloc(limit)])).error).toBeFalsy();
    expect((await handle('image/png', [Buffer.alloc(limit + 1)])).error).toBeInstanceOf(PayloadTooLargeException);
  });

  it('surfaces a stream error instead of hanging', async () => {
    const stream = new PassThrough();
    const result = new Promise<Error | undefined>((resolve) => {
      sizeLimitedMemoryStorage()._handleFile({} as never, { mimetype: 'image/png', stream } as never, (err) => resolve(err as Error | undefined));
    });
    stream.emit('error', new Error('connection reset'));
    expect((await result)?.message).toBe('connection reset');
  });
});
