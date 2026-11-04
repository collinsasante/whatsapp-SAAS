import { PromptRedactionSession, describeErrorForLog, redactChatMessages, redactDeep, redactForDiagnostics } from './prompt-redaction.util';

const red = (t: string) => new PromptRedactionSession().redact(t);

describe('secrets are replaced irreversibly', () => {
  it.each([
    ['bearer header', 'Authorization: Bearer abcdEFGH1234567890xyz', 'abcdEFGH1234567890xyz'],
    ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fwpMeJf36P', 'eyJhbGciOiJIUzI1NiJ9'],
    ['sk key', 'my key is sk-proj-abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
    ['sk_live', 'sk_live_51HabcdefghijKLMNOP', '51HabcdefghijKLMNOP'],
    ['Meta token', 'EAAGm0PX4ZCpsBAKZCxyzXYZ0123456789abcdefghijklmnopqrstu', 'EAAGm0PX4ZCpsBAK'],
    ['AWS key id', 'AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['Google key', 'AIzaSyA-1234567890abcdefghijklmnopqrstuv', 'AIzaSyA-1234567890'],
    ['webhook secret', 'whsec_abcdef1234567890ABCDEF', 'abcdef1234567890'],
    ['telegram bot token', 'bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0123', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0123'],
    ['own ciphertext', 'enc:v1:AbCdEfGhIjKlMnOpQrStUvWx==', 'AbCdEfGhIjKlMnOpQrStUvWx'],
    ['labelled password', 'my password: hunter2xyz', 'hunter2xyz'],
    ['labelled with is', 'the otp is 482913', '482913'],
    ['quoted api key', `api_key = "abc123def456"`, 'abc123def456'],
    ['url token', 'https://x.example/file?token=SECRETVALUE123&a=1', 'SECRETVALUE123'],
    ['signed url', 'https://s3.example/b/k?X-Amz-Signature=deadbeef0123&X-Amz-Credential=AKIAXXXX/2026', 'deadbeef0123'],
    ['url userinfo', 'postgres://admin:s3cretpw@db.internal/app', 's3cretpw'],
    ['opaque long token', 'here you go a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'],
  ])('%s', (_n, input, secret) => {
    const s = new PromptRedactionSession();
    const out = s.redact(input);
    expect(out).not.toContain(secret);
    expect(s.restore(out)).not.toContain(secret);          // restoration can never bring a secret back
    expect(out).toMatch(/\[SECRET\]|\[CARD\]/);
  });

  it('keeps the label so the model still understands what was shared', () => {
    expect(red('my password: hunter2xyz')).toBe('my password: [SECRET]');
  });

  it('redacts card numbers that pass the Luhn check and keeps order numbers and ids that do not', () => {
    expect(red('card 4111 1111 1111 1111 thanks')).toBe('card [CARD] thanks');
    expect(red('card 4111-1111-1111-1111')).toBe('card [CARD]');
    expect(red('order 4111111111111112 placed')).toBe('order 4111111111111112 placed');   // fails Luhn
  });

  it('is idempotent', () => {
    const once = red('password: hunter2xyz mail a@b.co call +233244123456');
    expect(red(once)).toBe(once);
  });
});

describe('personal contact details become placeholders the session can restore', () => {
  it('replaces emails and phones, reuses a placeholder for the same value, and restores them', () => {
    const s = new PromptRedactionSession();
    const out = s.redact('Mail ama@shop.com or +233 24 412 3456, again ama@shop.com');
    expect(out).toBe('Mail [EMAIL_1] or [PHONE_1], again [EMAIL_1]');
    expect(s.restore('Sent to [EMAIL_1] and [PHONE_1]')).toBe('Sent to ama@shop.com and +233 24 412 3456');
    expect(s.stats).toMatchObject({ emails: 2, phones: 1 });
  });
  it('numbers distinct values separately and is case-insensitive for email', () => {
    const s = new PromptRedactionSession();
    expect(s.redact('A@x.com a@X.com b@x.com')).toBe('[EMAIL_1] [EMAIL_1] [EMAIL_2]');
  });
  it('does not restore a placeholder the session never issued, and can tell', () => {
    const s = new PromptRedactionSession();
    s.redact('x@y.com');
    expect(s.restore('call [PHONE_9]')).toBe('call [PHONE_9]');
    expect(s.hasUnknownPlaceholder('call [PHONE_9]')).toBe(true);
    expect(s.hasUnknownPlaceholder('mail [EMAIL_1]')).toBe(false);
  });
  it('recognises local and international phone shapes', () => {
    for (const p of ['+233244123456', '0244123456', '024 412 3456', '+1 (415) 555-2671', '233244123456', '(020) 7946 0958']) {
      expect(red(`call ${p} now`)).toBe('call [PHONE_1] now');
    }
  });
  it('leaves dates, times, amounts, order numbers and short numbers alone', () => {
    for (const t of ['2026-11-04 12:30', 'on 04/11/2026', 'total GHS 1,234,567.89', 'order ORD-20261104-0042', 'room 4021', 'pin code 12345', 'version 1.2.3.4567', 'at 10:30-11:45']) {
      expect(red(t)).toBe(t);
    }
  });
  it('does not treat a longer token containing digits as a phone', () => {
    expect(red('ref a0244123456b')).toBe('ref a0244123456b');
  });
});

describe('robustness', () => {
  it('handles nested messages, tool-call arguments, empty and malformed content without mutating the input', () => {
    type Msg = { role: string; content?: string | null; toolCalls?: Array<{ id: string; name: string; arguments: string }> };
    const input: Msg[] = [
      { role: 'user', content: 'mail me at a@b.co, password: pw12345' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'create_lead', arguments: '{"email":"a@b.co","token":"sk-abcdefghijklmnop1234"}' }] },
      { role: 'tool', content: null },
      { role: 'tool' },
    ];
    const snapshot = JSON.stringify(input);
    const s = new PromptRedactionSession();
    const out = redactChatMessages(input, s);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[0]!.content).toBe('mail me at [EMAIL_1], password: [SECRET]');
    expect(out[1]!.toolCalls![0]!.arguments).toContain('[EMAIL_1]');
    expect(out[1]!.toolCalls![0]!.arguments).not.toContain('sk-abcdefghijklmnop1234');
    expect(s.restore(out[1]!.toolCalls![0]!.arguments)).toContain('"email":"a@b.co"');
  });
  it('stays fast on adversarial input', () => {
    const inputs = ['a@'.repeat(30_000), '1'.repeat(60_000), '+1 '.repeat(20_000), 'a.'.repeat(30_000) + '@', `${'x'.repeat(5000)}@${'y.'.repeat(5000)}`, '9'.repeat(40) + ' ' + '9'.repeat(40)];
    for (const i of inputs) {
      const t0 = Date.now();
      red(i); redactForDiagnostics(i);
      expect(Date.now() - t0).toBeLessThan(1500);
    }
  });
  it('cuts oversize input rather than scanning it all', () => {
    const out = red('x'.repeat(100_000));
    expect(out.length).toBeLessThan(61_000);
    expect(out.endsWith('[CUT]')).toBe(true);
  });
});

describe('diagnostics redaction', () => {
  it('replaces without placeholders and cannot be restored', () => {
    expect(redactForDiagnostics('mail a@b.co or +233244123456, password: hunter2xyz')).toBe('mail [EMAIL] or [PHONE], password: [SECRET]');
  });
  it('redacts deep structures, secret-named keys wholesale, and survives cycles and odd types', () => {
    const cyc: Record<string, unknown> = { a: 1 }; cyc['self'] = cyc;
    expect(() => redactDeep(cyc)).not.toThrow();
    expect(redactDeep({ args: { email: 'a@b.co', accessToken: 'x', list: ['+233244123456', 5, null, undefined, true] } }))
      .toEqual({ args: { email: '[EMAIL]', accessToken: '[redacted]', list: ['[PHONE]', 5, null, undefined, true] } });
  });
});

describe('describeErrorForLog', () => {
  it('never exposes the request an HTTP client error carries', () => {
    const err = Object.assign(new Error('Request failed with status code 401'), {
      name: 'AxiosError', code: 'ERR_BAD_REQUEST', response: { status: 401, data: { error: 'bad key sk-abcdefghijklmnop1234' } },
      config: { headers: { Authorization: 'Bearer sk-abcdefghijklmnop1234' }, data: '{"messages":[{"content":"my card 4111111111111111"}]}' },
    });
    const text = describeErrorForLog(err);
    expect(text).toBe('AxiosError code=ERR_BAD_REQUEST status=401 Request failed with status code 401');
    expect(text).not.toMatch(/sk-|4111|Bearer|messages/);
  });
  it('drops a message that looks like a payload, and handles non-errors', () => {
    expect(describeErrorForLog(new Error('{"messages":[{"content":"secret talk"}]}'))).toBe('Error');
    expect(describeErrorForLog(undefined)).toBe('error');
    expect(describeErrorForLog('password: hunter2xyz')).toBe('password: [SECRET]');
  });
});
