/**
 * The TikTok Business Messaging API wire contract used by this adapter, with the PROVENANCE of every item.
 *
 * TikTok's reference pages (business-api.tiktok.com/portal/docs) are rendered client-side and could not be read when this was written, so only part of the
 * contract could be confirmed. Each entry says where it comes from:
 *   official  - stated in TikTok's own published documentation (search-index excerpts of the portal pages)
 *   secondary - reported by an integrator that ships a working integration (Chatwoot, Infobip); consistent but not read from TikTok directly
 *   assumed   - a reasonable guess that MUST be checked against the portal before the feature is switched on
 *
 * The adapter refuses to talk to TikTok unless an operator has set TIKTOK_MESSAGING_CONTRACT_CONFIRMED=true, which they should only do after checking every
 * `assumed` and `secondary` item below against the portal and a real sandbox exchange. Nothing here is "verified against a real TikTok account".
 */
export type Provenance = 'official' | 'secondary' | 'assumed';

export interface ContractItem<T> { value: T; provenance: Provenance; note?: string }
const item = <T>(value: T, provenance: Provenance, note?: string): ContractItem<T> => ({ value, provenance, note });

export const TIKTOK_BUSINESS_API_BASE = 'https://business-api.tiktok.com';

export const CONTRACT = {
  // Where requests go
  webhookListPath: item('/open_api/v1.3/business/webhook/list/', 'official', 'GET with app id, secret and event_type=DIRECT_MESSAGE'),
  webhookEventType: item('DIRECT_MESSAGE', 'official'),
  webhookUpdatePath: item('/open_api/v1.3/business/webhook/update/', 'assumed'),
  tokenPath: item('/open_api/v1.3/oauth2/access_token/', 'assumed', 'documented for the Business API generally; the messaging authorisation may differ'),
  refreshPath: item('/open_api/v1.3/oauth2/refresh_token/', 'assumed'),
  authorizePath: item('/portal/auth', 'assumed', 'query: app_id, state, redirect_uri'),
  sendPath: item('/open_api/v1.3/business/message/send/', 'assumed'),
  conversationListPath: item('/open_api/v1.3/business/message/conversation/list/', 'assumed'),
  messageListPath: item('/open_api/v1.3/business/message/list/', 'assumed'),
  imageUploadPath: item('/open_api/v1.3/business/message/image/upload/', 'assumed'),
  imageDownloadPath: item('/open_api/v1.3/business/message/image/download/', 'assumed'),
  // Behaviour
  conversationsStartWithUser: item(true, 'official', 'a TikTok user must message the business first'),
  failureIsHttp200WithNonZeroCode: item(true, 'secondary'),
  replyWindowHours: item(48, 'secondary', 'Chatwoot documents 48 hours; Infobip says outbound messages have a limited validity period without a number'),
  maxTextChars: item(6000, 'secondary'),
  outboundTypes: item(['text', 'image'] as const, 'secondary', 'text or a single image; they cannot be combined in one message'),
  imageMimeTypes: item(['image/jpeg', 'image/png'] as const, 'secondary'),
  imageMaxBytes: item(3 * 1024 * 1024, 'secondary'),
  inboundTypes: item(['text', 'image', 'share_post', 'sticker'] as const, 'secondary'),
  // Webhook security
  signatureHeader: item('tiktok-signature', 'secondary', 'value "t=<unix seconds>,s=<hex>"'),
  signatureAlgorithm: item('HMAC-SHA256 over "<t>.<raw body>" with the app secret', 'secondary',
    'OFFICIAL for TikTok developer webhooks (developers.tiktok.com/doc/webhooks-verification, read 2026-11-04): header TikTok-Signature "t=<timestamp>,s=<signature>", signed string t + "." + raw body, HMAC-SHA256 keyed with the client secret. The same layout is reported for Business Messaging by an integrator, but the Business Messaging page itself could not be read'),
  signatureToleranceSeconds: item(300, 'assumed',
    'TikTok states no window ("reject timestamps that are too old"); an integrator uses 5 s. 300 s tolerates clock drift and delayed redelivery, and replays are harmless because every message is de-duplicated by its id'),
  webhookNeedsHttp200: item(true, 'official'),
  eventNames: item({ message: 'im_send_msg', read: 'im_mark_read_msg' }, 'secondary'),
  // Account eligibility
  businessAccountsOnly: item(true, 'secondary', 'personal and creator accounts are not supported'),
  blockedRegions: item(['EEA', 'Switzerland', 'United Kingdom'], 'secondary'),
  mustAcceptDirectMessages: item(true, 'secondary', 'the account must accept messages from everyone, or each user must be accepted manually in the TikTok app'),
  accessNeedsApproval: item(true, 'official', 'apply in the developer portal; data security and privacy reviews must be completed'),
  permissionToEnable: item('TikTok Accounts', 'secondary', 'under "Scope of permission" in the app settings, after approval'),
  accessTokenHours: item(24, 'secondary'),
} as const;

export type ContractKey = keyof typeof CONTRACT;

/** Everything an operator must confirm before enabling the feature: every item that is not `official`. */
export function unconfirmedContractItems(): Array<{ key: string; provenance: Provenance; value: unknown; note?: string }> {
  return (Object.entries(CONTRACT) as Array<[string, ContractItem<unknown>]>)
    .filter(([, v]) => v.provenance !== 'official')
    .map(([key, v]) => ({ key, provenance: v.provenance, value: v.value, note: v.note }));
}

/** What must be true, outside the code, before real messaging can work. Reported as-is by the status endpoint and the docs. */
export const PROVIDER_REQUIREMENTS = [
  'A TikTok for Business developer app (business-api.tiktok.com/portal/apps) with Terms of Service and Privacy Policy URLs.',
  'Business Messaging API access approved by TikTok for that app (application plus data security and privacy reviews).',
  'The "TikTok Accounts" permission enabled in the app\'s Scope of permission after approval.',
  'The redirect URL registered on the app, and a public HTTPS webhook URL TikTok can reach (answering HTTP 200).',
  'A TikTok Business Account outside the EEA, Switzerland and the United Kingdom, set to accept direct messages.',
  'The app id and secret supplied to the server as TIKTOK_BUSINESS_APP_ID / TIKTOK_BUSINESS_APP_SECRET (these are not the Login Kit client key).',
  'An operator confirming the wire contract against the portal (TIKTOK_MESSAGING_CONTRACT_CONFIRMED=true).',
] as const;
