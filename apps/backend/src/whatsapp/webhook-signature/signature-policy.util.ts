import { verifyWhatsAppSignature } from '../webhook-signature.util';

/**
 * Pure policy for WhatsApp webhook signatures when several Meta apps deliver webhooks.
 *
 * Meta signs the raw body with the secret of the app that owns the webhook subscription. One platform serves WABAs subscribed to several
 * apps, so no single secret can verify everything. A request is genuine when its signature matches the secret of a registered app AND every
 * WABA named in the payload is mapped to that app (an app whose secret leaks cannot be used to forge events for another app's WABA).
 */

export type SignatureMode = 'off' | 'observe' | 'enforce';

export type SignatureOutcome =
  | 'valid' // matches a registered app, every WABA in the payload is mapped to it
  | 'valid_no_waba' // matches a registered app; the payload names no WABA (nothing to map)
  | 'app_not_mapped' // matches a registered app, but a WABA in the payload is not mapped to that app
  | 'invalid' // secrets are registered and none matches
  | 'missing_signature' // secrets are registered and the request carries no usable x-hub-signature-256
  | 'no_secrets'; // no secret is registered at all, so nothing can be concluded

export interface SigningApp {
  appId: string;
  secret: string;
  /** WABA ids this app is mapped to, or 'all' for the legacy single-secret setting (maps nothing, covers everything). */
  wabaIds: ReadonlySet<string> | 'all';
}

export interface SignatureEvaluation {
  outcome: SignatureOutcome;
  /** The registered app whose secret matched, when one did. */
  appId: string | null;
  wabaIds: string[];
}

const MAX_WABA_IDS = 20;
const WABA_ID = /^\d{5,25}$/;

/**
 * The WABA ids named in a webhook body. The body is NOT yet authenticated, so this is only used to decide which registered mappings to compare
 * against; the HMAC is what authenticates. Non-numeric, oversized or excess values are ignored.
 */
export function extractWabaIds(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const ids = new Set<string>();
  for (const entry of entries.slice(0, MAX_WABA_IDS)) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && WABA_ID.test(id)) ids.add(id);
  }
  return [...ids];
}

export function resolveSignatureMode(raw: string | undefined, nodeEnv: string | undefined): { mode: SignatureMode; explicit: boolean; ignoredValue?: string } {
  const value = raw?.trim().toLowerCase();
  if (value === 'off' || value === 'observe' || value === 'enforce') return { mode: value, explicit: true };
  // Production never enforces by default: enforcing needs a deliberate, explicit setting once the registry covers every live WABA. Elsewhere the
  // long-standing behaviour is kept: verify when a secret is configured, accept (with a warning) when none is.
  const fallback: SignatureMode = nodeEnv === 'production' ? 'observe' : 'enforce';
  return { mode: fallback, explicit: false, ...(value ? { ignoredValue: value.slice(0, 20) } : {}) };
}

export function evaluateSignature(input: { rawBody: Buffer | undefined; header: string | undefined; apps: readonly SigningApp[]; wabaIds: readonly string[] }): SignatureEvaluation {
  const { rawBody, header, apps, wabaIds } = input;
  const ids = [...wabaIds];
  if (apps.length === 0) return { outcome: 'no_secrets', appId: null, wabaIds: ids };
  if (!rawBody || !header?.startsWith('sha256=')) return { outcome: 'missing_signature', appId: null, wabaIds: ids };

  // Every candidate is computed (no early exit on the first match) so timing does not reveal which app matched.
  const matched = apps.filter((app) => verifyWhatsAppSignature(rawBody, header, app.secret));
  if (matched.length === 0) return { outcome: 'invalid', appId: null, wabaIds: ids };

  const covering = matched.find((app) => ids.every((waba) => app.wabaIds === 'all' || app.wabaIds.has(waba)));
  if (covering) return { outcome: ids.length > 0 ? 'valid' : 'valid_no_waba', appId: covering.appId, wabaIds: ids };
  return { outcome: 'app_not_mapped', appId: matched[0]!.appId, wabaIds: ids };
}

export interface SignatureDecision {
  accept: boolean;
  /** Enforce was requested but there is nothing to enforce with, so the request was let through. Always logged as an error. */
  degraded: boolean;
}

export function decideSignature(mode: SignatureMode, outcome: SignatureOutcome): SignatureDecision {
  if (mode !== 'enforce') return { accept: true, degraded: false };
  // Self-lockout guard: enforcing with no registered secret would refuse every webhook of every tenant.
  if (outcome === 'no_secrets') return { accept: true, degraded: true };
  return { accept: outcome === 'valid' || outcome === 'valid_no_waba', degraded: false };
}
