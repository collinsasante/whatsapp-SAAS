import { normaliseTelegramUpdate, telegramMessageIdFromKey, telegramMessageKey } from './telegram-update.util';

const msg = (extra: object, chat: object = { id: 42, type: 'private' }, from: object = { id: 42, is_bot: false, first_name: 'Ama', last_name: 'Mensah' }) =>
  ({ update_id: 1, message: { message_id: 7, date: 1_800_000_000, chat, from, ...extra } });

describe('normaliseTelegramUpdate', () => {
  it('reads text and the sender name', () => {
    expect(normaliseTelegramUpdate(msg({ text: 'hi' }))).toMatchObject({ ok: true, inbound: { chatId: '42', messageId: 7, text: 'hi', senderName: 'Ama Mensah', dateMs: 1_800_000_000_000 } });
  });
  it('falls back to @username when there is no name', () => {
    expect(normaliseTelegramUpdate(msg({ text: 'x' }, undefined, { id: 1, is_bot: false, username: 'ama' }))).toMatchObject({ inbound: { senderName: '@ama' } });
  });
  it('picks the largest photo and uses the caption as text', () => {
    const r = normaliseTelegramUpdate(msg({ caption: 'order', photo: [{ file_id: 'S', file_size: 1 }, { file_id: 'L', file_size: 9 }] }));
    expect(r).toMatchObject({ ok: true, inbound: { text: 'order', attachment: { kind: 'image', fileId: 'L' } } });
  });
  it.each([['voice', 'audio'], ['audio', 'audio'], ['video', 'video'], ['video_note', 'video'], ['animation', 'video'], ['document', 'file']])('maps %s to %s', (key, kind) => {
    expect(normaliseTelegramUpdate(msg({ [key]: { file_id: 'F', file_size: 3 } }))).toMatchObject({ inbound: { attachment: { kind, fileId: 'F' } } });
  });
  it('labels content it cannot display', () => {
    expect(normaliseTelegramUpdate(msg({ sticker: { emoji: '😀' } }))).toMatchObject({ inbound: { placeholder: '[Sticker 😀]' } });
    expect(normaliseTelegramUpdate(msg({ location: { latitude: 1, longitude: 2 } }))).toMatchObject({ inbound: { placeholder: '[Shared a location]' } });
  });
  it.each([
    ['null', null], ['an array', []], ['an edit', { edited_message: {} }], ['a callback', { callback_query: {} }],
    ['a group', msg({ text: 'x' }, { id: -1, type: 'group' })], ['a channel', msg({ text: 'x' }, { id: -1, type: 'channel' })],
    ['a bot sender', msg({ text: 'x' }, undefined, { id: 2, is_bot: true })], ['no chat', { message: { message_id: 1 } }],
    ['no message id', { message: { chat: { id: 1, type: 'private' }, text: 'x' } }],
  ])('ignores %s', (_n, u) => {
    expect(normaliseTelegramUpdate(u)).toMatchObject({ ok: false });
  });
});

describe('telegram message keys', () => {
  it('round-trips and is scoped by bot and chat', () => {
    expect(telegramMessageKey('5', '42', 7)).toBe('tg:5:42:7');
    expect(telegramMessageIdFromKey('tg:5:42:7')).toBe(7);
    expect(telegramMessageKey('5', '42', 7)).not.toBe(telegramMessageKey('6', '42', 7));
  });
  it('rejects keys from other channels', () => {
    expect(telegramMessageIdFromKey('wamid.ABC')).toBeUndefined();
    expect(telegramMessageIdFromKey(undefined)).toBeUndefined();
  });
});
