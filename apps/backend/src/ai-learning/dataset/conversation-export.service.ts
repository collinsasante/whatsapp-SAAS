import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { RedactionCounts, mergeCounts, REDACTION_VERSION } from '../../common/privacy/pii-redaction.util';
import { buildRecord, pseudonym } from './dataset-builder.util';
import { DatasetRecord, ExclusionReason, Stratum } from './dataset.types';
import { ExportCursor, ExportSource } from './export-source';

export const MAX_WINDOW_DAYS = 92;
export const MAX_LIMIT = 2000;
export const MAX_PAGE_SIZE = 200;
export const TOOL_VERSION = '1';
const FILES = { data: 'data.jsonl', manifest: 'manifest.json', cursor: 'cursor.json', refs: 'exported-refs.txt' } as const;
const APPROVAL_ID = /^[A-Za-z0-9._-]{6,64}$/;

export class ExportRefusedError extends Error {
  constructor(message: string) { super(message); this.name = 'ExportRefusedError'; }
}

export interface ExportOptions {
  tenantId: string;
  from: Date;
  to: Date;
  limit: number;
  pageSize: number;
  mode: 'dry-run' | 'write';
  outDir?: string;
  approvalId?: string;
  /** HMAC key for pseudonyms. A dry run may use a throwaway key; a write needs the real, persistent one. */
  pseudonymKey: string;
  exportId: string;
}

export interface ExportReport {
  exportId: string;
  mode: 'dry-run' | 'write';
  tool: { version: string; redactionVersion: string };
  tenantRef: string;
  window: { from: string; to: string };
  limit: number;
  examined: number;
  exported: number;
  excluded: Record<ExclusionReason, number>;
  roles: { customer: number; ai: number; human_agent: number; system: number };
  byStratum: Partial<Record<Stratum, number>>;
  bySplit: { dev: number; heldout: number };
  redactions: RedactionCounts;
  truncatedConversations: number;
  bytes: number;
  /** True when this run continued an earlier one. The cursor itself (it holds a raw conversation id) is never put in a report. */
  resumed: boolean;
  /** Conversations examined in earlier runs of this same export, counted against --limit. */
  priorExamined: number;
  complete: boolean;
  /** True when more conversations remain in the window (re-run with the same arguments, and a higher --limit if it was reached). */
  resumable: boolean;
  approvalId?: string;
  generatedAt: string;
}

/** True when `dir` or any parent is a Git work tree: real conversations must never be written where `git add` could pick them up. */
export function isInsideGitWorkTree(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Every refusal happens here, before any database read or file write. */
export function assertExportAllowed(o: ExportOptions): void {
  if (!o.tenantId.trim()) throw new ExportRefusedError('A tenant id is required: an export covers exactly one tenant.');
  if (!(o.from instanceof Date) || !(o.to instanceof Date) || Number.isNaN(o.from.getTime()) || Number.isNaN(o.to.getTime())) throw new ExportRefusedError('--from and --to must be valid dates.');
  if (o.to.getTime() <= o.from.getTime()) throw new ExportRefusedError('--to must be after --from.');
  if ((o.to.getTime() - o.from.getTime()) / 86_400_000 > MAX_WINDOW_DAYS) throw new ExportRefusedError(`The time window is limited to ${MAX_WINDOW_DAYS} days.`);
  if (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > MAX_LIMIT) throw new ExportRefusedError(`--limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  if (!Number.isInteger(o.pageSize) || o.pageSize < 1 || o.pageSize > MAX_PAGE_SIZE) throw new ExportRefusedError(`--page-size must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  if (o.mode === 'write') {
    if (!o.approvalId || !APPROVAL_ID.test(o.approvalId)) throw new ExportRefusedError('A write needs --approval-id: the reference of the written approval for this export (6-64 letters, digits, . _ -).');
    if (!o.outDir || !path.isAbsolute(o.outDir)) throw new ExportRefusedError('A write needs --out-dir as an absolute path.');
    if (isInsideGitWorkTree(o.outDir)) throw new ExportRefusedError('--out-dir is inside a Git work tree. Choose a directory outside any repository.');
    if (o.pseudonymKey.length < 32) throw new ExportRefusedError('DATASET_PSEUDONYM_KEY must be at least 32 characters for a write.');
  }
}

const emptyReport = (o: ExportOptions, tenantRef: string, resumed: boolean, priorExamined: number, now: Date): ExportReport => ({
  exportId: o.exportId, mode: o.mode, tool: { version: TOOL_VERSION, redactionVersion: REDACTION_VERSION }, tenantRef,
  window: { from: o.from.toISOString(), to: o.to.toISOString() }, limit: o.limit, examined: 0, exported: 0,
  excluded: { simulated: 0, eval_contact: 0, no_customer_message: 0, too_short: 0, duplicate: 0 },
  roles: { customer: 0, ai: 0, human_agent: 0, system: 0 }, byStratum: {}, bySplit: { dev: 0, heldout: 0 }, redactions: {},
  truncatedConversations: 0, bytes: 0, resumed, priorExamined, complete: false, resumable: true, approvalId: o.approvalId, generatedAt: now.toISOString(),
});

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Exports ONE tenant's conversations for a bounded window, redacted and pseudonymized. A dry run does the same work and prints counts
 * only; it writes nothing. A write is resumable (the cursor and the set of exported refs live beside the data) and never exports the
 * same conversation twice. Neither mode ever prints or logs message text.
 */
export async function runExport(source: ExportSource, o: ExportOptions, now: () => Date = () => new Date()): Promise<ExportReport> {
  assertExportAllowed(o);
  const tenantRef = pseudonym(o.pseudonymKey, 'ten', o.tenantId, 12);
  const write = o.mode === 'write';

  let resumed: ExportCursor | null = null;
  let priorExamined = 0;
  const seen = new Set<string>();
  let dataFile = '';
  if (write) {
    const dir = o.outDir as string;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    dataFile = path.join(dir, FILES.data);
    const stored = readJson<{ tenantRef: string; from: string; to: string; cursor: ExportCursor | null; examined?: number }>(path.join(dir, FILES.cursor));
    if (stored) {
      if (stored.tenantRef !== tenantRef || stored.from !== o.from.toISOString() || stored.to !== o.to.toISOString()) {
        throw new ExportRefusedError('--out-dir already holds an export for a different tenant or window. Use an empty directory, or the same arguments to resume.');
      }
      resumed = stored.cursor;
      priorExamined = typeof stored.examined === 'number' ? stored.examined : 0;
      if (fs.existsSync(path.join(dir, FILES.refs))) fs.readFileSync(path.join(dir, FILES.refs), 'utf8').split('\n').filter(Boolean).forEach((r) => seen.add(r));
    }
  }

  const report = emptyReport(o, tenantRef, resumed !== null, priorExamined, now());
  let after = resumed;

  // --limit counts every conversation examined by every run of this export, so resuming cannot quietly exceed it.
  while (priorExamined + report.examined < o.limit) {
    const take = Math.min(o.pageSize, o.limit - priorExamined - report.examined);
    const page = await source.readPage({ tenantId: o.tenantId, from: o.from, to: o.to, after, take });
    if (page.length === 0) { report.complete = true; report.resumable = false; break; }

    const lines: string[] = [];
    const refs: string[] = [];
    for (const raw of page) {
      report.examined++;
      const built = buildRecord(raw, o.pseudonymKey, o.exportId);
      if (!built.ok) { report.excluded[built.reason]++; continue; }
      const rec: DatasetRecord = built.record;
      if (seen.has(rec.conversationRef)) { report.excluded.duplicate++; continue; }
      seen.add(rec.conversationRef);
      refs.push(rec.conversationRef);
      report.exported++;
      report.bySplit[rec.split]++;
      report.byStratum[rec.stratum] = (report.byStratum[rec.stratum] ?? 0) + 1;
      if (rec.provenance.truncatedTurns) report.truncatedConversations++;
      for (const t of rec.turns) report.roles[t.role]++;
      mergeCounts(report.redactions, built.redactions);
      const line = JSON.stringify(rec);
      report.bytes += Buffer.byteLength(line) + 1;
      lines.push(line);
    }

    const last = page[page.length - 1];
    after = { updatedAt: last.updatedAt.toISOString(), id: last.id };

    if (write) {
      const dir = o.outDir as string;
      if (lines.length) fs.appendFileSync(dataFile, lines.join('\n') + '\n', { mode: 0o600 });
      if (refs.length) fs.appendFileSync(path.join(dir, FILES.refs), refs.join('\n') + '\n', { mode: 0o600 });
      writeAtomic(path.join(dir, FILES.cursor), JSON.stringify({ tenantRef, from: o.from.toISOString(), to: o.to.toISOString(), cursor: after, examined: priorExamined + report.examined }));
    }
    if (page.length < take) { report.complete = true; report.resumable = false; break; }
  }

  report.generatedAt = now().toISOString();
  if (write) writeAtomic(path.join(o.outDir as string, FILES.manifest), JSON.stringify(report, null, 2));
  return report;
}

/**
 * Deletes the files this tool wrote for one export, after checking the manifest names that export, and leaves a manifest recording the
 * deletion (counts only, no content). It removes nothing else in the directory.
 */
export function purgeExport(outDir: string, exportId: string, now: () => Date = () => new Date()): string[] {
  if (!path.isAbsolute(outDir)) throw new ExportRefusedError('--out-dir must be an absolute path.');
  const manifestPath = path.join(outDir, FILES.manifest);
  const manifest = readJson<Record<string, unknown>>(manifestPath);
  if (!manifest || manifest['exportId'] !== exportId) throw new ExportRefusedError('The manifest in --out-dir does not match this export id; nothing was deleted.');
  const removed: string[] = [];
  for (const f of [FILES.data, FILES.refs, FILES.cursor]) {
    const p = path.join(outDir, f);
    if (fs.existsSync(p)) { fs.rmSync(p); removed.push(f); }
  }
  writeAtomic(manifestPath, JSON.stringify({ ...manifest, purgedAt: now().toISOString(), purgedFiles: removed }, null, 2));
  return removed;
}
