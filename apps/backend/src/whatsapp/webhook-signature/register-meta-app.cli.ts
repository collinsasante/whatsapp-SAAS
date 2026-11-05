/**
 * Registers one Meta app (id, label, secret) and optionally maps WABAs to it. The secret is read from a hidden prompt, or from stdin when piped, and
 * NEVER from the command line (arguments are visible in `ps` and shell history). Prints the app id, label and a short fingerprint, never the secret.
 *
 * On the server, inside the backend container (it needs the same CREDENTIALS_ENCRYPTION_KEY the app runs with):
 *
 *   docker exec -it <backend-container> node dist/whatsapp/webhook-signature/register-meta-app.cli.js \
 *     --app-id 1234567890 --label "Example app" --map <tenantId>:<wabaId> --map <tenantId>:<wabaId>
 *
 * Running it again with the same --app-id replaces the secret. A running backend picks the change up within a minute.
 */
import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';
import { registerMetaApp } from './register-meta-app';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Muting the echo: the prompt is written once, every later character the terminal would echo is swallowed.
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
  process.stdout.write('Meta app secret (input hidden): ');
  rlAny._writeToOutput = () => undefined;
  return new Promise((resolve) => rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); }));
}

async function main() {
  const appId = arg('--app-id');
  const label = arg('--label');
  if (!appId || !label) throw new Error('usage: --app-id <numeric id> --label "<name>" [--map <tenantId>:<wabaId>]...  (the secret is asked for, never passed as an argument)');
  const prisma = new PrismaClient();
  try {
    const report = await registerMetaApp(
      {
        upsertApp: async (id, data) => prisma.whatsappMetaApp.upsert({ where: { appId: id }, create: { appId: id, ...data }, update: data, select: { id: true } }),
        ownsWaba: async (tenantId, wabaId) => (await prisma.whatsAppNumber.count({ where: { tenantId, wabaId } })) > 0,
        mapWaba: async (tenantId, wabaId, metaAppId) => { await prisma.whatsappWabaApp.upsert({ where: { tenantId_wabaId_metaAppId: { tenantId, wabaId, metaAppId } }, create: { tenantId, wabaId, metaAppId, source: 'manual' }, update: {} }); },
      },
      { appId, label, secret: await readSecret(), mappings: args('--map'), encryptionKey: process.env['CREDENTIALS_ENCRYPTION_KEY'] },
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; });
