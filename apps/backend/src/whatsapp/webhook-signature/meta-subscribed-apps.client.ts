import { Injectable } from '@nestjs/common';
import axios from 'axios';

export interface SubscribedApp {
  appId: string;
  name: string | null;
  /** Host only. A per-WABA callback override would mean Meta does not call the platform's default URL for this app. */
  overrideCallbackHost: string | null;
}

export type SubscribedAppsResult = { ok: true; apps: SubscribedApp[] } | { ok: false; status: number | null; code: number | null; message: string };

/**
 * Read-only lookup of which Meta apps are subscribed to a WhatsApp Business Account (GET /{waba-id}/subscribed_apps). It is the authoritative source
 * for the WABA-to-app mapping. The access token is used for this one request and never logged or returned.
 */
@Injectable()
export class MetaSubscribedAppsClient {
  private readonly version = 'v23.0';

  async list(wabaId: string, accessToken: string): Promise<SubscribedAppsResult> {
    try {
      const res = await axios.get(`https://graph.facebook.com/${this.version}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15_000,
      });
      const data = Array.isArray(res.data?.data) ? (res.data.data as Array<Record<string, unknown>>) : [];
      const apps = data.flatMap((row) => {
        const api = (row['whatsapp_business_api_data'] ?? {}) as Record<string, unknown>;
        const id = typeof api['id'] === 'string' ? api['id'] : null;
        if (!id) return [];
        const override = typeof row['override_callback_uri'] === 'string' ? row['override_callback_uri'] : '';
        let host: string | null = null;
        try { host = override ? new URL(override).host : null; } catch { host = 'unparseable'; }
        return [{ appId: id, name: typeof api['name'] === 'string' ? api['name'] : null, overrideCallbackHost: host }];
      });
      return { ok: true, apps };
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { code?: number; message?: string } } } };
      // Only the status, Meta's error code and a short sanitised message: the request (and with it the token) is never echoed.
      return { ok: false, status: e.response?.status ?? null, code: e.response?.data?.error?.code ?? null, message: (e.response?.data?.error?.message ?? 'request failed').replace(/\d{6,}/g, '<n>').slice(0, 120) };
    }
  }
}
