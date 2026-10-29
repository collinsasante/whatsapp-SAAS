import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertExportAllowed, ExportOptions, ExportRefusedError, isInsideGitWorkTree, MAX_LIMIT, MAX_WINDOW_DAYS, purgeExport, runExport } from './conversation-export.service';
import { RawConversation } from './dataset-builder.util';
import { ExportSource, PageRequest } from './export-source';

const KEY = 'k'.repeat(40);
const D = (day: number, sec = 0) => new Date(Date.UTC(2026, 9, day, 10, 0, sec));
const aiAgent = { isAiAgent: true, name: 'Verz' };
const human = { isAiAgent: false, name: 'Esi Owusu' };

function rawConv(i: number, over: Partial<RawConversation> = {}): RawConversation {
  return {
    id: `c${String(i).padStart(4, '0')}`, tenantId: 'tenant-1', updatedAt: D(2 + Math.floor(i / 50), i), createdAt: D(1),
    contact: { name: 'Kofi Mensah', phone: '+233241234567', isEvalContact: false },
    messages: [
      { id: `m${i}a`, direction: 'INBOUND', type: 'TEXT', content: `question ${i} from Kofi on 0241234567`, createdAt: D(2, i), metadata: null, deletedForEveryone: false, sender: null },
      { id: `m${i}b`, direction: 'OUTBOUND', type: 'TEXT', content: `answer ${i}`, createdAt: D(2, i + 1), metadata: null, deletedForEveryone: false, sender: i % 3 === 0 ? human : aiAgent },
    ],
    evaluations: [], ...over,
  };
}

/** An in-memory source that honours the tenant, window, cursor and take, like the real one. It records every request. */
function fakeSource(all: RawConversation[]) {
  const requests: PageRequest[] = [];
  const sorted = [...all].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id));
  const source: ExportSource = {
    async readPage(req) {
      requests.push(req);
      return sorted
        .filter((c) => c.tenantId === req.tenantId && c.updatedAt >= req.from && c.updatedAt < req.to)
        .filter((c) => !req.after || c.updatedAt.getTime() > new Date(req.after.updatedAt).getTime() || (c.updatedAt.getTime() === new Date(req.after.updatedAt).getTime() && c.id > req.after.id))
        .slice(0, req.take);
    },
  };
  return { source, requests };
}

const base = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  tenantId: 'tenant-1', from: D(1), to: D(20), limit: 100, pageSize: 25, mode: 'dry-run', pseudonymKey: KEY, exportId: 'exp_test_1', ...over,
});

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-spec-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('assertExportAllowed: every refusal happens before any read or write', () => {
  const refuses = (o: ExportOptions, msg: RegExp) => expect(() => assertExportAllowed(o)).toThrow(msg);
  it.each([
    ['no tenant', { tenantId: ' ' }, /tenant id is required/],
    ['an invalid date', { from: new Date('nope') }, /valid dates/],
    ['to before from', { to: D(0) }, /after --from/],
    ['a window over the limit', { to: new Date(D(1).getTime() + (MAX_WINDOW_DAYS + 1) * 86_400_000) }, /limited to/],
    ['a limit of zero', { limit: 0 }, /--limit/],
    ['a limit over the maximum', { limit: MAX_LIMIT + 1 }, /--limit/],
    ['a fractional limit', { limit: 1.5 }, /--limit/],
    ['a page size over the maximum', { pageSize: 500 }, /--page-size/],
  ])('%s', (_l, over, msg) => refuses(base(over as Partial<ExportOptions>), msg));

  it.each([
    ['no approval id', { approvalId: undefined, outDir: '/tmp/x' }, /--approval-id/],
    ['a malformed approval id', { approvalId: 'a b', outDir: '/tmp/x' }, /--approval-id/],
    ['no out dir', { approvalId: 'APPR-2026-001' }, /--out-dir/],
    ['a relative out dir', { approvalId: 'APPR-2026-001', outDir: 'relative/path' }, /absolute/],
    ['a short pseudonym key', { approvalId: 'APPR-2026-001', outDir: '/tmp/x', pseudonymKey: 'short' }, /at least 32/],
  ])('a write with %s', (_l, over, msg) => refuses(base({ mode: 'write', ...(over as Partial<ExportOptions>) }), msg));

  it('a write inside a Git work tree is refused (real conversations must never be committable)', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    expect(isInsideGitWorkTree(path.join(repo, 'data', 'out'))).toBe(true);
    refuses(base({ mode: 'write', approvalId: 'APPR-2026-001', outDir: path.join(repo, 'data', 'out') }), /Git work tree/);
    expect(isInsideGitWorkTree(path.join(dir, 'elsewhere'))).toBe(false);
  });

  it('a dry run needs none of the write requirements', () => expect(() => assertExportAllowed(base())).not.toThrow());
});

describe('runExport: dry run', () => {
  it('reports counts only, writes nothing, and never puts text, ids or names in the report', async () => {
    const { source } = fakeSource(Array.from({ length: 60 }, (_, i) => rawConv(i)));
    const report = await runExport(source, base());
    expect(report).toMatchObject({ mode: 'dry-run', examined: 60, exported: 60, complete: true });
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/question|answer|Kofi|Mensah|Esi|0241234567|tenant-1|c00\d\d|cursor|"id"/);
    expect(report.tenantRef).toMatch(/^ten_[0-9a-f]{12}$/);
    expect(report.bySplit.dev + report.bySplit.heldout).toBe(60);
    expect(report.roles.customer).toBe(60);
    expect(report.roles.ai + report.roles.human_agent).toBe(60);
    expect(report.redactions.PHONE).toBe(60);
    expect(report.bytes).toBeGreaterThan(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('is bounded by --limit and pages by --page-size, always for the one tenant and window asked for', async () => {
    const { source, requests } = fakeSource(Array.from({ length: 300 }, (_, i) => rawConv(i)));
    const report = await runExport(source, base({ limit: 70, pageSize: 25 }));
    expect(report.examined).toBe(70);
    expect(report.complete).toBe(false);
    expect(requests.map((r) => r.take)).toEqual([25, 25, 20]);
    expect(requests.every((r) => r.tenantId === 'tenant-1' && r.from.getTime() === D(1).getTime() && r.to.getTime() === D(20).getTime())).toBe(true);
    expect(report.resumable).toBe(true);
  });

  it('never reaches another tenant\'s conversations', async () => {
    const other = rawConv(500, { tenantId: 'tenant-2' });
    const { source } = fakeSource([rawConv(1), other]);
    const report = await runExport(source, base());
    expect(report.examined).toBe(1);
  });

  it('counts exclusions by reason and keeps Test Chat conversations out', async () => {
    const sim = rawConv(1, { contact: { name: 'T', phone: '+0003458935471', isEvalContact: false } });
    const evalC = rawConv(2, { contact: { name: 'E', phone: '+233200000000', isEvalContact: true } });
    const short = rawConv(3, { messages: [rawConv(3).messages[0]] });
    const { source } = fakeSource([sim, evalC, short, rawConv(4)]);
    const report = await runExport(source, base());
    expect(report.excluded).toEqual({ simulated: 1, eval_contact: 1, no_customer_message: 0, too_short: 1, duplicate: 0 });
    expect(report.exported).toBe(1);
  });
});

describe('runExport: write', () => {
  const writeOpts = (over: Partial<ExportOptions> = {}) => base({ mode: 'write', outDir: path.join(dir, 'out'), approvalId: 'APPR-2026-001', ...over });

  it('writes redacted JSONL with owner-only permissions, a manifest and a cursor, and no raw identifiers', async () => {
    const { source } = fakeSource(Array.from({ length: 10 }, (_, i) => rawConv(i)));
    const report = await runExport(source, writeOpts());
    const out = path.join(dir, 'out');
    expect(fs.readdirSync(out).sort()).toEqual(['cursor.json', 'data.jsonl', 'exported-refs.txt', 'manifest.json']);
    expect(fs.statSync(out).mode & 0o777).toBe(0o700);
    for (const f of ['data.jsonl', 'manifest.json', 'cursor.json', 'exported-refs.txt']) expect(fs.statSync(path.join(out, f)).mode & 0o777).toBe(0o600);
    const lines = fs.readFileSync(path.join(out, 'data.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(10);
    const all = lines.join('\n');
    expect(all).not.toMatch(/0241234567|Kofi|Mensah|Esi|Owusu|tenant-1|"id":"c0|2026-10-0\dT/);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ schemaVersion: 1, provenance: { source: 'production', exportId: 'exp_test_1' } });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ exportId: 'exp_test_1', approvalId: 'APPR-2026-001', exported: 10, complete: true });
    expect(JSON.stringify(manifest)).not.toMatch(/tenant-1|Kofi|0241234567|c00\d\d|cursor/);
    expect(report.exported).toBe(10);
  });

  it('is resumable, never exports a conversation twice, and --limit counts every run together', async () => {
    const all = Array.from({ length: 120 }, (_, i) => rawConv(i));
    const first = await runExport(fakeSource(all).source, writeOpts({ limit: 50, pageSize: 25 }));
    expect(first).toMatchObject({ exported: 50, complete: false, resumable: true, resumed: false, priorExamined: 0 });
    const second = await runExport(fakeSource(all).source, writeOpts({ limit: 100, pageSize: 25 }));
    expect(second).toMatchObject({ exported: 50, resumed: true, priorExamined: 50, resumable: true });
    const repeat = await runExport(fakeSource(all).source, writeOpts({ limit: 100, pageSize: 25 }));
    expect(repeat).toMatchObject({ examined: 0, exported: 0, priorExamined: 100 }); // the limit is already used up
    const third = await runExport(fakeSource(all).source, writeOpts({ limit: 200, pageSize: 25 }));
    expect(third).toMatchObject({ exported: 20, complete: true, resumable: false });
    const lines = fs.readFileSync(path.join(dir, 'out', 'data.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(120);
    expect(new Set(lines.map((l) => JSON.parse(l).conversationRef)).size).toBe(120);
  });

  it('re-running the exact same finished export adds nothing', async () => {
    const all = Array.from({ length: 30 }, (_, i) => rawConv(i));
    await runExport(fakeSource(all).source, writeOpts());
    const again = await runExport(fakeSource(all).source, writeOpts());
    expect(again.exported).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'out', 'data.jsonl'), 'utf8').trim().split('\n')).toHaveLength(30);
  });

  it('refuses to mix a different tenant or window into an existing out dir', async () => {
    await runExport(fakeSource([rawConv(1)]).source, writeOpts());
    await expect(runExport(fakeSource([rawConv(1)]).source, writeOpts({ tenantId: 'tenant-2' }))).rejects.toThrow(/different tenant or window/);
    await expect(runExport(fakeSource([rawConv(1)]).source, writeOpts({ to: D(19) }))).rejects.toThrow(/different tenant or window/);
  });

  it('refuses before reading anything when a gate fails', async () => {
    const { source, requests } = fakeSource([rawConv(1)]);
    await expect(runExport(source, writeOpts({ approvalId: undefined }))).rejects.toBeInstanceOf(ExportRefusedError);
    expect(requests).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'out'))).toBe(false);
  });

  it('the same conversation gets the same reference on a later export with the same key, and a different one with another key', async () => {
    const all = [rawConv(1), rawConv(2)];
    const a = await runExport(fakeSource(all).source, writeOpts({ outDir: path.join(dir, 'a') }));
    const b = await runExport(fakeSource(all).source, writeOpts({ outDir: path.join(dir, 'b') }));
    const c = await runExport(fakeSource(all).source, writeOpts({ outDir: path.join(dir, 'c'), pseudonymKey: 'z'.repeat(40) }));
    const refs = (d: string) => fs.readFileSync(path.join(dir, d, 'exported-refs.txt'), 'utf8');
    expect(refs('a')).toBe(refs('b'));
    expect(refs('a')).not.toBe(refs('c'));
    expect([a.exported, b.exported, c.exported]).toEqual([2, 2, 2]);
  });
});

describe('purgeExport', () => {
  it('deletes the data, refs and cursor, keeps a content-free manifest recording it, and touches nothing else', async () => {
    const out = path.join(dir, 'out');
    await runExport(fakeSource([rawConv(1), rawConv(2)]).source, base({ mode: 'write', outDir: out, approvalId: 'APPR-2026-001' }));
    fs.writeFileSync(path.join(out, 'unrelated.txt'), 'keep me');
    const removed = purgeExport(out, 'exp_test_1', () => new Date('2026-11-01T00:00:00Z'));
    expect(removed.sort()).toEqual(['cursor.json', 'data.jsonl', 'exported-refs.txt']);
    expect(fs.readdirSync(out).sort()).toEqual(['manifest.json', 'unrelated.txt']);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))).toMatchObject({ exportId: 'exp_test_1', purgedAt: '2026-11-01T00:00:00.000Z' });
  });
  it('refuses when the export id does not match, a relative path is given, or there is no manifest; nothing is deleted', async () => {
    const out = path.join(dir, 'out');
    await runExport(fakeSource([rawConv(1)]).source, base({ mode: 'write', outDir: out, approvalId: 'APPR-2026-001' }));
    expect(() => purgeExport(out, 'exp_other')).toThrow(/does not match/);
    expect(() => purgeExport('relative', 'exp_test_1')).toThrow(/absolute/);
    expect(() => purgeExport(path.join(dir, 'nowhere'), 'exp_test_1')).toThrow(/does not match/);
    expect(fs.existsSync(path.join(out, 'data.jsonl'))).toBe(true);
  });
});
