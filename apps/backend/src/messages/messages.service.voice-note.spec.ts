import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { MessageType } from '@whatsapp-platform/shared-types';
import { isOggBuffer } from '../common/media/audio.util';
import { MessagesService } from './messages.service';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const describeReal = hasFfmpeg ? describe : describe.skip;

function build(storedBytes: Buffer, storedMime = 'audio/webm') {
  const storageService = {
    downloadBuffer: jest.fn().mockResolvedValue({ buffer: storedBytes, mimeType: storedMime }),
    uploadRaw: jest.fn().mockResolvedValue({ fileKey: 't1/new.ogg', fileUrl: 'https://app.test/api/v1/media/serve/t1~new.ogg' }),
  };
  const whatsAppWebService = { sendMedia: jest.fn().mockResolvedValue('provider-1'), sendText: jest.fn() };
  const args: unknown[] = new Array(21).fill({});
  args[5] = storageService; args[20] = whatsAppWebService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as any;
  return { service, storageService, whatsAppWebService };
}
const conversation = { channel: { id: 'chan1', type: 'WHATSAPP_WEB' } };
const contact = { phone: '+233555000111', externalId: null };
const mediaUrl = 'https://app.test/api/v1/media/serve/t1~voice-note.webm';
const send = (service: ReturnType<typeof build>['service']) =>
  service.dispatchOutbound('t1', conversation, contact, { kind: 'MEDIA', mediaType: MessageType.AUDIO, mediaUrl, caption: 'Voice note' });

describeReal('voice note to a WhatsApp Web (QR) customer -- real recording, real ffmpeg', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-send-'));
  let webm: Buffer;
  beforeAll(() => {
    const f = path.join(tmp, 'v.webm');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-c:a', 'libopus', f]);
    webm = fs.readFileSync(f);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('converts the WebM recording to OGG/Opus, stores it, and sends it as a push-to-talk voice note without a caption', async () => {
    const { service, storageService, whatsAppWebService } = build(webm);
    await send(service);

    const [buffer, mime, tenant, name] = storageService.uploadRaw.mock.calls[0];
    expect(isOggBuffer(buffer)).toBe(true);
    expect([mime, tenant, name]).toEqual(['audio/ogg', 't1', 'voice-note.ogg']);

    expect(whatsAppWebService.sendMedia).toHaveBeenCalledWith(
      't1', 'chan1', '+233555000111', 'https://app.test/api/v1/media/serve/t1~new.ogg', 'audio', undefined, { voiceNote: true },
    );
  });

  it('fails the send with a clear message, and sends nothing, when the recording cannot be converted', async () => {
    const corrupt = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('not really webm')]);
    const { service, whatsAppWebService, storageService } = build(corrupt);
    await expect(send(service)).rejects.toThrow('could not be converted');
    expect(whatsAppWebService.sendMedia).not.toHaveBeenCalled();
    expect(storageService.uploadRaw).not.toHaveBeenCalled();
  });
});

describe('other audio sent to a WhatsApp Web customer', () => {
  it('passes an OGG file straight through as a voice note, with no re-upload', async () => {
    const { service, storageService, whatsAppWebService } = build(Buffer.from('OggS\u0000rest'), 'audio/ogg');
    await send(service);
    expect(storageService.uploadRaw).not.toHaveBeenCalled();
    expect(whatsAppWebService.sendMedia).toHaveBeenCalledWith('t1', 'chan1', '+233555000111', mediaUrl, 'audio', undefined, { voiceNote: true });
  });

  it('passes an MP3 through as an ordinary audio file, not a voice note', async () => {
    const { service, whatsAppWebService } = build(Buffer.from('ID3\u0004mp3data'), 'audio/mpeg');
    await send(service);
    expect(whatsAppWebService.sendMedia).toHaveBeenCalledWith('t1', 'chan1', '+233555000111', mediaUrl, 'audio', undefined, { voiceNote: false });
  });

  it('refuses a file marked as audio that is not audio, instead of sending it', async () => {
    const { service, whatsAppWebService } = build(Buffer.from('<html>'), 'text/html');
    await expect(send(service)).rejects.toThrow(BadRequestException);
    expect(whatsAppWebService.sendMedia).not.toHaveBeenCalled();
  });

  it('images are untouched by the audio handling', async () => {
    const { service, storageService, whatsAppWebService } = build(Buffer.from('x'), 'image/png');
    await service.dispatchOutbound('t1', conversation, contact, { kind: 'MEDIA', mediaType: MessageType.IMAGE, mediaUrl: 'https://app.test/a.png', caption: 'Hi' });
    expect(storageService.downloadBuffer).not.toHaveBeenCalled();
    expect(whatsAppWebService.sendMedia).toHaveBeenCalledWith('t1', 'chan1', '+233555000111', 'https://app.test/a.png', 'image', 'Hi');
  });
});
