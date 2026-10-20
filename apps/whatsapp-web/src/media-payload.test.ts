import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaPayload, fileNameFromUrl } from './media-payload';

const buf = Buffer.from('bytes');

test('a recorded voice note goes out as push-to-talk OGG/Opus, with no caption', () => {
  const p = buildMediaPayload({ mediaType: 'audio', buffer: buf, voiceNote: true, caption: 'Voice note', mimetype: 'audio/ogg' });
  assert.deepEqual(p, { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  assert.equal('caption' in p, false);
});

test('an ordinary audio file is not forced into the OGG/Opus label and is not a voice note', () => {
  const mp3 = buildMediaPayload({ mediaType: 'audio', buffer: buf, mimetype: 'audio/mpeg' });
  assert.deepEqual(mp3, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
  const m4a = buildMediaPayload({ mediaType: 'audio', buffer: buf, mimetype: 'audio/mp4; codecs=mp4a.40.2' });
  assert.equal(m4a.mimetype, 'audio/mp4');
  assert.equal(m4a.ptt, false);
});

test('audio with a missing or non-audio content type falls back to mp3 rather than mislabelling', () => {
  assert.equal(buildMediaPayload({ mediaType: 'audio', buffer: buf }).mimetype, 'audio/mpeg');
  assert.equal(buildMediaPayload({ mediaType: 'audio', buffer: buf, mimetype: 'application/octet-stream' }).mimetype, 'audio/mpeg');
});

test('documents keep their real type and file name (they were all sent as an unnamed octet-stream)', () => {
  const p = buildMediaPayload({ mediaType: 'document', buffer: buf, mimetype: 'application/pdf; charset=binary', fileName: 'invoice-204.pdf', caption: 'Your invoice' });
  assert.deepEqual(p, { document: buf, mimetype: 'application/pdf', fileName: 'invoice-204.pdf', caption: 'Your invoice' });
});

test('a document with nothing known still gets a safe default name and type', () => {
  const p = buildMediaPayload({ mediaType: 'document', buffer: buf });
  assert.deepEqual(p, { document: buf, mimetype: 'application/octet-stream', fileName: 'file' });
});

test('images and videos keep captions and a matching content type, and ignore a wrong one', () => {
  assert.deepEqual(buildMediaPayload({ mediaType: 'image', buffer: buf, caption: 'Look', mimetype: 'image/png' }), { image: buf, caption: 'Look', mimetype: 'image/png' });
  assert.deepEqual(buildMediaPayload({ mediaType: 'image', buffer: buf, mimetype: 'text/html' }), { image: buf });
  assert.deepEqual(buildMediaPayload({ mediaType: 'video', buffer: buf, mimetype: 'video/mp4' }), { video: buf, mimetype: 'video/mp4' });
});

test('fileNameFromUrl returns a decoded last segment and ignores the query', () => {
  assert.equal(fileNameFromUrl('https://x.test/api/v1/media/serve/t1~abc.pdf?sig=1'), 't1~abc.pdf');
  assert.equal(fileNameFromUrl('https://x.test/files/My%20Report.pdf'), 'My Report.pdf');
  assert.equal(fileNameFromUrl('https://x.test/'), undefined);
  assert.equal(fileNameFromUrl('not a url'), undefined);
});
