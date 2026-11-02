import { isSafeStorageKey, resolveInsideDir, safeFileExtension } from './storage-key.util';

describe('storage key safety', () => {
  it.each(['3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607/0a1b2c3d-1111-2222-3333-444455556666.jpg', 'tenant-1/abc.pdf', 'file.png', 'tenant-1/legacy upload (1).png'])('accepts the app\'s own key shape: %s', (key) => {
    expect(isSafeStorageKey(key)).toBe(true);
  });

  it.each([
    '../../etc/passwd', '..', 'a/../../b', '/etc/passwd', 'a//b', 'a/./b', '.env', 'a/.hidden', 'a\\b', 'a/b\0.png', '', 'a/b/', 'x'.repeat(301),
  ])('rejects %j', (key) => {
    expect(isSafeStorageKey(key)).toBe(false);
  });

  it.each([undefined, null, 5, {}, ['a']])('rejects a non-string %j', (key) => {
    expect(isSafeStorageKey(key)).toBe(false);
  });

  it('resolves a good key inside the directory and refuses an escape', () => {
    expect(resolveInsideDir('/srv/uploads', 't1/a.png')).toBe('/srv/uploads/t1/a.png');
    expect(() => resolveInsideDir('/srv/uploads', '../secrets')).toThrow('Invalid storage key');
    expect(() => resolveInsideDir('/srv/uploads', '/etc/passwd')).toThrow('Invalid storage key');
  });

  it('builds a servable extension from any original name', () => {
    expect(safeFileExtension('.JPG')).toBe('.jpg');
    expect(safeFileExtension('.p/../ng')).toBe('.png');
    expect(safeFileExtension('')).toBe('');
    expect(safeFileExtension('.a b!')).toBe('.ab');
    expect(isSafeStorageKey(`t1/id${safeFileExtension('.<script>')}`)).toBe(true);
  });
});
