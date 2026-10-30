/**
 * Exports one tenant's real conversations, redacted and pseudonymized, for AI evaluation. Run it ON the host that is allowed to read
 * the data, with a READ-ONLY database role. It defaults to a dry run that prints counts only.
 *
 *   dry run:  EXPORT_DATABASE_URL=... npm run dataset:export -- --tenant-id <id> --from 2026-10-01 --to 2026-10-15 --limit 200
 *   write:    EXPORT_DATABASE_URL=... DATASET_PSEUDONYM_KEY=... npm run dataset:export -- --tenant-id <id> --from ... --to ... --write \
 *               --out-dir /secure/location/outside/any/repo --approval-id <written-approval-reference>
 *   delete:   npm run dataset:export -- --purge <export-id> --out-dir /secure/location/...
 *
 * Neither mode prints message text, tenant ids or connection strings. See docs/AI_LEARNING_CONVERSATION_DATA.md.
 */
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ExportOptions, ExportRefusedError, MAX_LIMIT, purgeExport, runExport } from './conversation-export.service';
import { PrismaExportSource } from './export-source';

export interface ParsedArgs {
  tenantId?: string; from?: string; to?: string; limit: number; pageSize: number; write: boolean;
  outDir?: string; approvalId?: string; exportId?: string; purge?: string; help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { limit: 200, pageSize: 100, write: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ExportRefusedError(`${a} needs a value.`);
      return v;
    };
    switch (a) {
      case '--tenant-id': out.tenantId = next(); break;
      case '--from': out.from = next(); break;
      case '--to': out.to = next(); break;
      case '--limit': out.limit = Number(next()); break;
      case '--page-size': out.pageSize = Number(next()); break;
      case '--out-dir': out.outDir = next(); break;
      case '--approval-id': out.approvalId = next(); break;
      case '--export-id': out.exportId = next(); break;
      case '--purge': out.purge = next(); break;
      case '--write': out.write = true; break;
      case '--help': case '-h': out.help = true; break;
      default: throw new ExportRefusedError(`Unknown argument ${a}.`);
    }
  }
  return out;
}

export function buildOptions(args: ParsedArgs, env: NodeJS.ProcessEnv, now: Date = new Date()): ExportOptions {
  const write = args.write;
  const key = env['DATASET_PSEUDONYM_KEY'] ?? '';
  if (write && !key) throw new ExportRefusedError('A write needs DATASET_PSEUDONYM_KEY (the same key every time for this dataset, kept in your secret store).');
  if (!args.tenantId) throw new ExportRefusedError('--tenant-id is required.');
  if (!args.from || !args.to) throw new ExportRefusedError('--from and --to are required (for example 2026-10-01).');
  return {
    tenantId: args.tenantId,
    from: new Date(args.from),
    to: new Date(args.to),
    limit: args.limit,
    pageSize: args.pageSize,
    mode: write ? 'write' : 'dry-run',
    outDir: args.outDir,
    approvalId: args.approvalId,
    // A dry run needs no persistent key: pseudonyms in it are discarded with the process.
    pseudonymKey: write ? key : randomBytes(32).toString('hex'),
    exportId: args.exportId ?? `exp_${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${randomBytes(2).toString('hex')}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`Usage: see the header of conversation-export.cli.ts (default is a dry run; max --limit ${MAX_LIMIT}).\n`);
    return;
  }
  if (args.purge) {
    if (!args.outDir) throw new ExportRefusedError('--purge needs --out-dir.');
    process.stdout.write(JSON.stringify({ purged: args.purge, files: purgeExport(args.outDir, args.purge) }) + '\n');
    return;
  }
  const url = process.env['EXPORT_DATABASE_URL'];
  if (!url) throw new ExportRefusedError('EXPORT_DATABASE_URL is required: use a database role that can only read.');
  const options = buildOptions(args, process.env);
  const prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const report = await runExport(new PrismaExportSource(prisma), options);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`${report.mode}: examined ${report.examined}, exported ${report.exported}, complete=${report.complete}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Only our own refusals are shown; anything else could carry a connection string or row data.
    process.stderr.write(err instanceof ExportRefusedError ? `Refused: ${err.message}\n` : 'The export failed (details withheld; check the database role and connectivity).\n');
    process.exit(1);
  });
}
