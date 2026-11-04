import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { DeepSeekProvider } from './deepseek.provider';

jest.mock('axios');
const post = (axios as jest.Mocked<typeof axios>).post;

const SECRET = 'sk-proj-abcdefghijklmnop1234';
const reply = (message: object) => ({ data: { model: 'deepseek-v4-flash', choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
const sent = (n = 0) => JSON.stringify((post.mock.calls[n]![1] as unknown));

describe('what the provider is sent (model boundary redaction)', () => {
  let provider: DeepSeekProvider;
  beforeEach(() => { provider = new DeepSeekProvider(); process.env.DEEPSEEK_API_KEY = 'test-key'; jest.clearAllMocks(); jest.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => jest.restoreAllMocks());

  it('never sends secrets, emails or phone numbers from any message role, and still sends the surrounding context', async () => {
    post.mockResolvedValueOnce(reply({ content: 'ok' }));
    await provider.complete({
      modelKey: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: `Business notes. Admin password: hunter2xyz` },
        { role: 'user', content: `Hi, mail ama@shop.com or call +233244123456. My api key is ${SECRET}` },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'create_lead', arguments: '{"email":"ama@shop.com","phone":"+233244123456"}' }] },
        { role: 'tool', toolCallId: 'c1', content: '{"saved":true,"owner":"kofi@team.com","note":"card 4111 1111 1111 1111"}' },
      ],
    });
    const body = sent();
    for (const raw of ['ama@shop.com', '+233244123456', SECRET, 'hunter2xyz', 'kofi@team.com', '4111 1111 1111 1111']) expect(body).not.toContain(raw);
    expect(body).toContain('[EMAIL_1]');
    expect(body).toContain('[PHONE_1]');
    expect(body).toContain('Hi, mail');                                   // context survives
    expect(body).toContain('create_lead');
    expect(JSON.stringify(post.mock.calls[0]![2])).toContain('Bearer test-key');   // the provider's own API key travels only in the header
  });

  it('puts the customer\'s own details back into the reply and into tool arguments, but never a secret', async () => {
    post.mockResolvedValueOnce(reply({
      content: 'I will email [EMAIL_1] and text [PHONE_1]. Your key [SECRET] is safe.',
      tool_calls: [{ id: 'c9', function: { name: 'create_lead', arguments: '{"email":"[EMAIL_1]","phone":"[PHONE_1]"}' } }],
    }));
    const r = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [{ role: 'user', content: `mail ama@shop.com phone 0244123456 key ${SECRET}` }] });
    expect(r.content).toBe('I will email ama@shop.com and text 0244123456. Your key [SECRET] is safe.');
    expect(r.toolCalls[0]!.arguments).toBe('{"email":"ama@shop.com","phone":"0244123456"}');
    expect(r.content).not.toContain(SECRET);
  });

  it('does not invent values for placeholders the model made up', async () => {
    post.mockResolvedValueOnce(reply({ content: 'Call [PHONE_7]' }));
    const r = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hello' }] });
    expect(r.content).toBe('Call [PHONE_7]');
  });

  it('redacts every retry attempt, not only the first', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 503 } }));
    post.mockResolvedValueOnce(reply({ content: 'ok' }));
    await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [{ role: 'user', content: `mail ama@shop.com ${SECRET}` }] });
    expect(post).toHaveBeenCalledTimes(2);
    for (const n of [0, 1]) { expect(sent(n)).not.toContain('ama@shop.com'); expect(sent(n)).not.toContain(SECRET); }
  });

  it('does not mutate the caller\'s messages (so the tool loop keeps real values for its own records)', async () => {
    post.mockResolvedValueOnce(reply({ content: 'ok' }));
    const messages = [{ role: 'user' as const, content: 'mail ama@shop.com' }];
    await provider.complete({ modelKey: 'deepseek-v4-flash', messages });
    expect(messages[0]!.content).toBe('mail ama@shop.com');
  });

  it('keeps placeholder numbering stable across tool rounds, so a placeholder from round 1 still maps in round 2', async () => {
    post.mockResolvedValueOnce(reply({ content: '' , tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{"to":"[EMAIL_2]"}' } }] }));
    const round1 = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'a@x.com and b@x.com' }] });
    expect(round1.toolCalls[0]!.arguments).toBe('{"to":"b@x.com"}');
    post.mockResolvedValueOnce(reply({ content: 'sent to [EMAIL_2]' }));
    const round2 = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [
      { role: 'user', content: 'a@x.com and b@x.com' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', arguments: round1.toolCalls[0]!.arguments }] }, { role: 'tool', toolCallId: 'c1', content: 'ok' },
    ] });
    expect(round2.content).toBe('sent to b@x.com');
  });
});

describe('structural guard: every code path that calls the model redacts first', () => {
  const root = path.resolve(__dirname, '../..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(p)) : /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });
  it('only the three known call sites use the DeepSeek endpoint, and each uses the redactor', () => {
    const users = walk(root).filter((f) => fs.readFileSync(f, 'utf8').includes('DEEPSEEK_API_URL') && !f.endsWith(path.join('common', 'deepseek.ts')));
    expect(users.map((f) => path.relative(root, f)).sort()).toEqual([
      path.join('ai', 'ai-responder.service.ts'), path.join('ai-core', 'providers', 'deepseek.provider.ts'), path.join('commerce', 'evaluation', 'evaluation-scoring.service.ts'),
    ].sort());
    for (const f of users) expect(fs.readFileSync(f, 'utf8')).toContain('PromptRedactionSession');
  });
  it('no AI-path logger prints a raw error object, a stack or String(err)', () => {
    const offenders = walk(root).filter((f) => /[\\/](ai|ai-core|ai-learning)[\\/]/.test(f))
      .filter((f) => /logger\.(error|warn)\([^;]*(\$\{String\(err\)\}|err\.stack|, err\))/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
