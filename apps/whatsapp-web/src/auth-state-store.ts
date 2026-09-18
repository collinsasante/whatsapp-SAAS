import { PrismaClient } from '@prisma/client';
import { decryptCredential, encryptCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';
import {
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';

const ENCRYPTION_KEY = parseEncryptionKey(process.env['CREDENTIALS_ENCRYPTION_KEY']);

// Baileys' credential/key objects contain Buffer/Uint8Array fields that
// JSON.stringify mangles by default -- Baileys ships BufferJSON.replacer/
// reviver specifically for this, matching what its own useMultiFileAuthState
// helper uses internally.
import { BufferJSON } from '@whiskeysockets/baileys';

interface PersistedState {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
}

/**
 * Postgres-backed replacement for Baileys' built-in useMultiFileAuthState
 * (which writes to local disk -- ephemeral in a container, and the plan
 * explicitly requires a restart not to force re-scanning every QR code).
 * Holds the full auth state as one encrypted JSON blob in
 * WhatsAppWebSession.encryptedAuthState, mutated in memory and flushed to
 * the DB on a short debounce (Baileys can emit many rapid key writes during
 * initial pairing -- writing to Postgres on every single one would be both
 * slow and unnecessary).
 */
export class PostgresAuthStateStore {
  private state: PersistedState;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushDebounceMs = 1000;

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionId: string,
    initial: PersistedState,
  ) {
    this.state = initial;
  }

  static async load(prisma: PrismaClient, sessionId: string): Promise<PostgresAuthStateStore> {
    const row = await prisma.whatsAppWebSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (row.encryptedAuthState) {
      const decrypted = decryptCredential(row.encryptedAuthState, ENCRYPTION_KEY);
      const parsed = JSON.parse(decrypted, BufferJSON.reviver) as PersistedState;
      return new PostgresAuthStateStore(prisma, sessionId, parsed);
    }
    return new PostgresAuthStateStore(prisma, sessionId, { creds: initAuthCreds(), keys: {} });
  }

  get authState(): AuthenticationState {
    return {
      creds: this.state.creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const bucket = this.state.keys[type] ?? {};
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = bucket[id];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            }
            if (value !== undefined) result[id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        set: async (data: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>>) => {
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            this.state.keys[type] = this.state.keys[type] ?? {};
            const entries = data[type] ?? {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              if (value === null || value === undefined) {
                delete this.state.keys[type]![id];
              } else {
                this.state.keys[type]![id] = value;
              }
            }
          }
          this.scheduleFlush();
        },
      },
    };
  }

  /** Called by Baileys on `creds.update` -- the credentials object itself changed. */
  async saveCreds(): Promise<void> {
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, this.flushDebounceMs);
  }

  /** Force an immediate write, bypassing the debounce -- used before a clean shutdown. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const serialized = JSON.stringify(this.state, BufferJSON.replacer);
    const encrypted = encryptCredential(serialized, ENCRYPTION_KEY);
    await this.prisma.whatsAppWebSession.update({
      where: { id: this.sessionId },
      data: { encryptedAuthState: encrypted },
    }).catch(() => {
      // Session row may have been deleted (disconnect/logout) between the
      // debounce firing and this write landing -- not an error worth
      // crashing the process over.
    });
  }
}
