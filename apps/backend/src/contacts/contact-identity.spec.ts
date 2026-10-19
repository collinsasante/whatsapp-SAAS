import { classifyJid, isPlausiblePhoneDigits, looksLikeProviderId, usableContactName } from '@whatsapp-platform/shared-utils';

describe('classifyJid', () => {
  it('treats only @s.whatsapp.net user ids as phone numbers', () => {
    expect(classifyJid('233555000111@s.whatsapp.net')).toEqual({ kind: 'phone', id: '233555000111' });
    expect(classifyJid('233555000111:12@s.whatsapp.net')).toEqual({ kind: 'phone', id: '233555000111' }); // device suffix
  });
  it('never treats an anonymous @lid id as a phone number', () => {
    expect(classifyJid('1587145059558262@lid')).toEqual({ kind: 'lid', id: '1587145059558262' });
    expect(classifyJid('18601671151650@lid').kind).toBe('lid');
  });
  it('excludes groups and the status/broadcast feed from customer identities', () => {
    expect(classifyJid('120363025246125486@g.us').kind).toBe('group');
    expect(classifyJid('status@broadcast').kind).toBe('broadcast');
    expect(classifyJid('1234567890@broadcast').kind).toBe('broadcast');
  });
  it('handles malformed input without throwing', () => {
    for (const bad of [undefined, null, '', 'no-at-sign', '@s.whatsapp.net', ':3@lid']) {
      expect(['other']).toContain(classifyJid(bad as string).kind);
    }
  });
  it('does not call an implausible digit string on a phone JID a phone', () => {
    expect(classifyJid('18601671151650@s.whatsapp.net').kind).toBe('other'); // 14 digits starting with 1
  });
});

describe('isPlausiblePhoneDigits', () => {
  it.each([['233555000111', true], ['18005550123', true], ['447911123456', true]])('%s -> %s', (d, ok) => expect(isPlausiblePhoneDigits(d)).toBe(ok));
  it.each(['18601671151650', '1587145059558262', '0555000111', '12345', '1234567890123456', 'abc'])('rejects %s', (d) => expect(isPlausiblePhoneDigits(d)).toBe(false));
});

describe('provider ids are not names', () => {
  it.each(['GH.1587145059558262', '1587145059558262', 'lid:1587145059558262', 'GH-1587145059558262'])('%s is an opaque id', (v) => {
    expect(looksLikeProviderId(v)).toBe(true);
    expect(usableContactName(v)).toBeUndefined();
  });
  it.each(['Breezyyy', 'Ama Mensah', 'Kojo 2', 'A.B. Mensah', '  Esi  '])('%s is a real name', (v) => {
    expect(usableContactName(v)).toBe(v.trim());
  });
  it('returns undefined for empty values', () => {
    for (const v of [undefined, null, '', '   ']) expect(usableContactName(v)).toBeUndefined();
  });
});
