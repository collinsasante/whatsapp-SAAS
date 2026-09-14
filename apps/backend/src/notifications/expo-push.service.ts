import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
// Expo's own documented cap per request.
const BATCH_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends real push notifications via Expo's Push API -- plain axios (already a
 * dependency everywhere else in this codebase, e.g. PaystackGateway), not the
 * expo-server-sdk package, to avoid adding a dependency for what's a single
 * REST call. Never throws -- a push failure must never be why an in-app
 * notification (NotificationsService.create, the actual source of truth)
 * fails to persist.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  /** Returns the subset of tokens Expo reported as permanently invalid
   * (DeviceNotRegistered) -- callers should stop sending to these. Expo also
   * recommends checking receipts asynchronously for errors that don't
   * surface synchronously in the ticket; that follow-up pass is not
   * implemented here (see PushTokenService doc comment). */
  async send(tokens: string[], payload: PushPayload): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    if (tokens.length === 0) return { invalidTokens };

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      try {
        const res = await axios.post(
          EXPO_PUSH_API_URL,
          batch.map((token) => ({ to: token, title: payload.title, body: payload.body, data: payload.data ?? {}, sound: 'default' })),
          { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10_000 },
        );
        const tickets = (res.data?.data ?? []) as ExpoPushTicket[];
        tickets.forEach((ticket, idx) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(batch[idx]);
          } else if (ticket.status === 'error') {
            this.logger.warn(`Push delivery ticket error for a token: ${ticket.message ?? ticket.details?.error ?? 'unknown'}`);
          }
        });
      } catch (err) {
        this.logger.warn(`Expo push API call failed for a batch of ${batch.length} token(s): ${String(err)}`);
      }
    }

    return { invalidTokens };
  }
}
