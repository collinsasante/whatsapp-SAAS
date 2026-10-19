/**
 * Turns the raw error Meta returns from the Calling API into something a person can act on.
 * Facts used here come from Meta's Cloud API calling documentation: calling is NOT enabled by default,
 * the number needs a messaging limit of 2000 or above, and it is switched on either in WhatsApp Manager
 * (Account tools > Phone numbers > gear icon > Calls) or with POST /{phone-number-id}/settings.
 * This code only explains. It never changes the Meta account.
 */
export type CallingErrorCode =
  | 'CALLING_NOT_ENABLED'
  | 'CALL_PERMISSION_REQUIRED'
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CALLING_UNAVAILABLE';

export interface CallingErrorInfo {
  code: CallingErrorCode;
  message: string;
  /** Plain-language steps for the person who administers the Meta account. */
  steps: string[];
}

export interface RawCallError {
  message?: string;
  metaCode?: number;
  metaSubcode?: number;
}

const WHATSAPP_MANAGER_STEPS = [
  'Open WhatsApp Manager and go to Account tools > Phone numbers.',
  'Click the gear icon next to this number and open Calls.',
  'Turn calling on and save. Calling needs a messaging limit of 2,000 or above.',
];

export function classifyCallingError(raw: RawCallError): CallingErrorInfo {
  const text = (raw.message ?? '').toLowerCase();
  const code = raw.metaCode;

  if (text.includes('not configured for this workspace')) {
    return {
      code: 'NOT_CONFIGURED',
      message: 'WhatsApp Business is not connected for this workspace, so calls cannot be placed yet.',
      steps: ['Connect your WhatsApp Business number under Channels, then try again.'],
    };
  }
  if (text.includes('calling api not enabled') || text.includes('calling is not enabled') || text.includes('enable calling')) {
    return {
      code: 'CALLING_NOT_ENABLED',
      message: 'Calling is not turned on for this WhatsApp number yet.',
      steps: [
        ...WHATSAPP_MANAGER_STEPS,
        'Or ask the person who manages your Meta app to enable it with the settings API (POST /{phone_number_id}/settings with calling status ENABLED).',
        'We do not change your Meta settings for you. Once it is on, try the call again.',
      ],
    };
  }
  if (code === 138006 || text.includes('call permission') || text.includes('approved call')) {
    return {
      code: 'CALL_PERMISSION_REQUIRED',
      message: 'This customer has not given permission to be called yet.',
      steps: ['Send them a call permission request first. You can call once they approve.'],
    };
  }
  if (code === 190 || text.includes('access token') || text.includes('oauth')) {
    return {
      code: 'AUTH_FAILED',
      message: 'Meta rejected the connection for this number. The access token may have expired.',
      steps: ['Reconnect the WhatsApp number under Channels, then try again.'],
    };
  }
  if (code === 4 || code === 80007 || code === 130429 || text.includes('rate limit') || text.includes('too many')) {
    return {
      code: 'RATE_LIMITED',
      message: 'Too many calls were attempted in a short time. Wait a minute and try again.',
      steps: [],
    };
  }
  return {
    code: 'CALLING_UNAVAILABLE',
    message: 'The call could not be placed. Please try again in a moment.',
    steps: [],
  };
}

export type CallingStatusState = 'ENABLED' | 'DISABLED' | 'UNKNOWN';

/**
 * Reads calling.status from the body of GET /{phone-number-id}/settings.
 * Anything other than an explicit ENABLED or DISABLED is UNKNOWN: we never claim calling is off just
 * because the check itself failed (for example a permission error).
 */
export function readCallingStatus(body: unknown): { state: CallingStatusState; sipEnabled: boolean } {
  const calling = (body as { calling?: { status?: unknown; sip?: { status?: unknown } } } | null | undefined)?.calling;
  const status = typeof calling?.status === 'string' ? calling.status.toUpperCase() : '';
  const sipEnabled = typeof calling?.sip?.status === 'string' && calling.sip.status.toUpperCase() === 'ENABLED';
  if (status === 'ENABLED' || status === 'DISABLED') return { state: status, sipEnabled };
  return { state: 'UNKNOWN', sipEnabled };
}
