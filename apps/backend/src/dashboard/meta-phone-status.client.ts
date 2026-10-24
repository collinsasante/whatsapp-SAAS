import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { MetaCheckError } from './dashboard-command.types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';
const FIELDS = 'verified_name,display_phone_number,quality_rating,messaging_limit_tier,code_verification_status,name_status,status';
/** Meta error code for an expired, revoked or otherwise invalid access token. */
const TOKEN_ERROR_CODE = 190;

export interface MetaPhoneNode {
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  code_verification_status?: string;
  name_status?: string;
  status?: string;
}

export type MetaPhoneResult = { ok: true; data: MetaPhoneNode } | { ok: false; kind: MetaCheckError; message: string };

/** Reads one WhatsApp phone number's health straight from Meta. A separate class so tests can replace it. */
@Injectable()
export class MetaPhoneStatusClient {
  async fetch(phoneNumberId: string, accessToken: string): Promise<MetaPhoneResult> {
    try {
      const res = await axios.get<MetaPhoneNode>(`${GRAPH_API_BASE}/${encodeURIComponent(phoneNumberId)}`, {
        params: { fields: FIELDS },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 6_000,
      });
      return { ok: true, data: res.data };
    } catch (err) {
      const e = err as { response?: { data?: { error?: { code?: number; message?: string } } }; code?: string };
      const meta = e.response?.data?.error;
      if (meta?.code === TOKEN_ERROR_CODE) {
        return { ok: false, kind: 'TOKEN_INVALID', message: 'Meta rejected the saved access token. Reconnect this number in Channels.' };
      }
      if (meta) return { ok: false, kind: 'META_ERROR', message: `Meta returned an error (code ${meta.code ?? 'unknown'}).` };
      return { ok: false, kind: 'UNREACHABLE', message: 'Meta did not answer in time.' };
    }
  }
}
