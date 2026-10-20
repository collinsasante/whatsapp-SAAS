import { classifyCallingError, readCallingStatus } from './calling-errors.util';

describe('classifyCallingError', () => {
  const reported = 'Calling API not enabled. Enable calling for this phone number in WhatsApp Manager, or via the settings API: POST /{phone_number_id}/settings with calling configuration.';

  it('turns the reported Meta message into an actionable explanation with Manager steps', () => {
    const info = classifyCallingError({ message: reported });
    expect(info.code).toBe('CALLING_NOT_ENABLED');
    expect(info.message).toBe('Calling is not turned on for this WhatsApp number yet.');
    expect(info.steps.join(' ')).toContain('WhatsApp Manager');
    expect(info.steps.join(' ')).toContain('2,000');
    expect(info.steps.join(' ')).toContain('We do not change your Meta settings for you');
    expect(info.message).not.toContain('{phone_number_id}'); // raw API text is not shown as the headline
  });

  it('recognises the not-enabled error regardless of case or surrounding text', () => {
    for (const m of ['CALLING API NOT ENABLED', 'Error: calling is not enabled for this number', 'Please enable calling in settings']) {
      expect(classifyCallingError({ message: m }).code).toBe('CALLING_NOT_ENABLED');
    }
  });

  it('keeps the existing permission case (code 138006 or its wording)', () => {
    expect(classifyCallingError({ message: 'x', metaCode: 138006 }).code).toBe('CALL_PERMISSION_REQUIRED');
    expect(classifyCallingError({ message: 'No approved call permission for this user' }).code).toBe('CALL_PERMISSION_REQUIRED');
  });

  it('classifies a workspace with no WhatsApp connection', () => {
    expect(classifyCallingError({ message: 'WhatsApp Business API not configured for this workspace' }).code).toBe('NOT_CONFIGURED');
  });

  it('classifies expired tokens and rate limits', () => {
    expect(classifyCallingError({ message: 'Error validating access token', metaCode: 190 }).code).toBe('AUTH_FAILED');
    expect(classifyCallingError({ message: 'x', metaCode: 130429 }).code).toBe('RATE_LIMITED');
    expect(classifyCallingError({ message: 'Rate limit hit' }).code).toBe('RATE_LIMITED');
  });

  it('falls back to a safe generic message and never leaks the raw provider text', () => {
    const info = classifyCallingError({ message: 'Internal secret detail: token=abc123 at /var/app' });
    expect(info.code).toBe('CALLING_UNAVAILABLE');
    expect(JSON.stringify(info)).not.toContain('abc123');
    expect(classifyCallingError({}).code).toBe('CALLING_UNAVAILABLE');
  });
});

describe('readCallingStatus', () => {
  it('reads ENABLED and DISABLED from calling.status', () => {
    expect(readCallingStatus({ calling: { status: 'ENABLED' } })).toEqual({ state: 'ENABLED', sipEnabled: false });
    expect(readCallingStatus({ calling: { status: 'disabled' } })).toEqual({ state: 'DISABLED', sipEnabled: false });
  });
  it('reports SIP separately, since SIP disables the calling endpoints', () => {
    expect(readCallingStatus({ calling: { status: 'ENABLED', sip: { status: 'ENABLED' } } }).sipEnabled).toBe(true);
  });
  it('anything unexpected is UNKNOWN, never "disabled"', () => {
    for (const body of [null, undefined, {}, { calling: {} }, { calling: { status: 'PAUSED' } }, { calling: { status: 5 } }, 'text']) {
      expect(readCallingStatus(body).state).toBe('UNKNOWN');
    }
  });
});
