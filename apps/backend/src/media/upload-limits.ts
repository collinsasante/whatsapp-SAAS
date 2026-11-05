import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { MIME_TO_MEDIA_TYPE, normalizeMimeType } from './media.service';

const MB = 1024 * 1024;

/**
 * Per-category ceilings, enforced while the upload streams in. Meta accepts documents up to 100 MB and the composer
 * already caps everything but video at 64 MB, so only video (which the product accepts up to 512 MB) gets more.
 * The upload is held in memory until it is stored, so these bound how much one request can pin.
 */
export const MAX_UPLOAD_BYTES: Record<'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT', number> = {
  IMAGE: 16 * MB,
  AUDIO: 64 * MB,
  DOCUMENT: 100 * MB,
  VIDEO: 512 * MB,
};

export const LARGEST_UPLOAD_BYTES = Math.max(...Object.values(MAX_UPLOAD_BYTES));

export function maxBytesForMime(mimeType: string): number | undefined {
  const category = MIME_TO_MEDIA_TYPE[normalizeMimeType(mimeType)];
  return category ? MAX_UPLOAD_BYTES[category] : undefined;
}

/** Rejects a disallowed declared type before a single byte of the body is buffered. */
export function mediaFileFilter(_req: Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void): void {
  if (maxBytesForMime(file.mimetype) === undefined) {
    cb(new BadRequestException(`Unsupported file type: ${normalizeMimeType(file.mimetype) || 'unknown'}`), false);
    return;
  }
  cb(null, true);
}

/** In-memory storage (the same shape multer's own memoryStorage produces) that aborts as soon as a file passes its type's ceiling. */
export function sizeLimitedMemoryStorage(): StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      const limit = maxBytesForMime(file.mimetype) ?? 0;
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const fail = (err: Error) => {
        if (finished) return;
        finished = true;
        chunks.length = 0;
        file.stream.unpipe();
        file.stream.resume();
        cb(err);
      };
      file.stream.on('data', (chunk: Buffer) => {
        if (finished) return;
        size += chunk.length;
        if (size > limit) {
          fail(new PayloadTooLargeException(`File is too large. The limit for this type is ${Math.round(limit / MB)} MB`));
          return;
        }
        chunks.push(chunk);
      });
      file.stream.on('error', fail);
      file.stream.on('end', () => {
        if (finished) return;
        finished = true;
        const buffer = Buffer.concat(chunks, size);
        cb(null, { buffer, size });
      });
    },
    _removeFile(_req, file, cb) {
      delete (file as { buffer?: Buffer }).buffer;
      cb(null);
    },
  };
}
