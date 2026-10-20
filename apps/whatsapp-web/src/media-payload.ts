export type OutboundMediaType = 'image' | 'video' | 'audio' | 'document';

export interface MediaPayloadInput {
  mediaType: OutboundMediaType;
  buffer: Buffer;
  /** Content-Type reported by the server the file came from. */
  mimetype?: string;
  caption?: string;
  fileName?: string;
  /** Send audio as a push-to-talk voice note. Requires OGG/Opus bytes. */
  voiceNote?: boolean;
}

const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';

function bareMime(value: string | undefined): string | undefined {
  const bare = value?.split(';')[0]?.trim().toLowerCase();
  return bare || undefined;
}

/** Last path segment of a URL without the query string, decoded; undefined if there is no usable name. */
export function fileNameFromUrl(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the Baileys message content for an outbound media send. Each type needs its own shape:
 *  - voice notes must be OGG/Opus with ptt=true (Baileys otherwise labels any audio as ogg/opus, so MP3 or
 *    WebM bytes would arrive unplayable);
 *  - documents need a real mimetype and file name or the recipient gets an anonymous "file";
 *  - WhatsApp has no caption for audio.
 */
export function buildMediaPayload(input: MediaPayloadInput): Record<string, unknown> {
  const { mediaType, buffer, caption } = input;
  const mimetype = bareMime(input.mimetype);

  switch (mediaType) {
    case 'image':
      return { image: buffer, ...(caption ? { caption } : {}), ...(mimetype?.startsWith('image/') ? { mimetype } : {}) };
    case 'video':
      return { video: buffer, ...(caption ? { caption } : {}), ...(mimetype?.startsWith('video/') ? { mimetype } : {}) };
    case 'audio':
      if (input.voiceNote) return { audio: buffer, mimetype: VOICE_NOTE_MIME, ptt: true };
      return { audio: buffer, mimetype: mimetype?.startsWith('audio/') ? mimetype : 'audio/mpeg', ptt: false };
    case 'document':
      return {
        document: buffer,
        mimetype: mimetype && mimetype !== 'application/octet-stream' ? mimetype : 'application/octet-stream',
        fileName: input.fileName || 'file',
        ...(caption ? { caption } : {}),
      };
  }
}
