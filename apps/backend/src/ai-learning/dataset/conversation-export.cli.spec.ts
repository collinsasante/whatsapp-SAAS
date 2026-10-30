import { buildOptions, parseArgs } from './conversation-export.cli';
import { ExportRefusedError } from './conversation-export.service';

const NOW = new Date('2026-10-29T12:00:00Z');
const KEY = 'k'.repeat(40);

describe('parseArgs', () => {
  it('defaults to a dry run with a modest limit', () => {
    expect(parseArgs([])).toMatchObject({ write: false, limit: 200, pageSize: 100, help: false });
  });
  it('reads every option', () => {
    const a = parseArgs(['--tenant-id', 't1', '--from', '2026-10-01', '--to', '2026-10-15', '--limit', '50', '--page-size', '10', '--write', '--out-dir', '/d', '--approval-id', 'APPR-1', '--export-id', 'exp_x']);
    expect(a).toMatchObject({ tenantId: 't1', from: '2026-10-01', to: '2026-10-15', limit: 50, pageSize: 10, write: true, outDir: '/d', approvalId: 'APPR-1', exportId: 'exp_x' });
  });
  it('rejects an unknown flag and a flag with no value', () => {
    expect(() => parseArgs(['--all-tenants'])).toThrow(ExportRefusedError);
    expect(() => parseArgs(['--tenant-id'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--tenant-id', '--from', 'x'])).toThrow(/needs a value/);
  });
  it('a non-numeric limit becomes NaN, which the gates then refuse', () => expect(Number.isNaN(parseArgs(['--limit', 'many']).limit)).toBe(true));
});

describe('buildOptions', () => {
  const dry = parseArgs(['--tenant-id', 't1', '--from', '2026-10-01', '--to', '2026-10-15']);

  it('a dry run needs no pseudonym key and uses a throwaway one that differs every time', () => {
    const a = buildOptions(dry, {}, NOW);
    const b = buildOptions(dry, {}, NOW);
    expect(a.mode).toBe('dry-run');
    expect(a.pseudonymKey).toHaveLength(64);
    expect(a.pseudonymKey).not.toBe(b.pseudonymKey);
  });
  it('a write requires the persistent pseudonym key from the environment and uses it', () => {
    const w = parseArgs(['--tenant-id', 't1', '--from', '2026-10-01', '--to', '2026-10-15', '--write']);
    expect(() => buildOptions(w, {}, NOW)).toThrow(/DATASET_PSEUDONYM_KEY/);
    expect(buildOptions(w, { DATASET_PSEUDONYM_KEY: KEY }, NOW)).toMatchObject({ mode: 'write', pseudonymKey: KEY });
  });
  it('requires one tenant and an explicit window: there is no "all tenants" or "everything" default', () => {
    expect(() => buildOptions(parseArgs(['--from', 'a', '--to', 'b']), {}, NOW)).toThrow(/--tenant-id/);
    expect(() => buildOptions(parseArgs(['--tenant-id', 't1']), {}, NOW)).toThrow(/--from and --to/);
  });
  it('generates a readable export id unless one is given to resume', () => {
    expect(buildOptions(dry, {}, NOW).exportId).toMatch(/^exp_20261029120000_[0-9a-f]{4}$/);
    expect(buildOptions(parseArgs(['--tenant-id', 't', '--from', 'a', '--to', 'b', '--export-id', 'exp_keep']), {}, NOW).exportId).toBe('exp_keep');
  });
  it('never puts the key or a connection string into the options object beyond the key field itself', () => {
    const o = buildOptions(dry, { DATASET_PSEUDONYM_KEY: KEY, EXPORT_DATABASE_URL: 'postgres://u:secret@h/db' }, NOW);
    expect(JSON.stringify(o)).not.toMatch(/secret|postgres:/);
  });
});
