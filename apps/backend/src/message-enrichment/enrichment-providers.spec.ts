import { EnrichmentProviderError, VISION_SYSTEM_PROMPT, describeImage, loadEnrichmentConfig, transcribeAudio } from './enrichment-providers';

const cfg = { baseUrl: 'https://api.example.test/v1', apiKey: 'KEY-0123456789', model: 'm' };
const audio = { buffer: Buffer.from('OggS'), mime: 'audio/ogg', ext: 'ogg' };
const image = { buffer: Buffer.from([1, 2, 3]), mime: 'image/png' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fail = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as EnrichmentProviderError; } throw new Error('expected a rejection'); };

describe('loadEnrichmentConfig', () => {
  it('is unavailable without keys, and says why', () => {
    const c = loadEnrichmentConfig({} as NodeJS.ProcessEnv);
    expect(c.transcription).toBeNull(); expect(c.vision).toBeNull();
    expect(c.transcriptionReason).toMatch(/no transcription API key/); expect(c.visionReason).toMatch(/no vision API key/);
  });
  it('uses OPENAI_API_KEY for both and the defaults', () => {
    const c = loadEnrichmentConfig({ OPENAI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv);
    expect(c.transcription).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' });
    expect(c.vision).toMatchObject({ model: 'gpt-4o-mini' });
  });
  it('NEVER enables vision for a model that is not on the vision-capable list (the platform chat model is text-only)', () => {
    for (const model of ['deepseek-v4-flash', 'deepseek-chat', 'gpt-3.5-turbo', 'some-text-model', '']) {
      const c = loadEnrichmentConfig({ VISION_API_KEY: 'k', VISION_MODEL: model } as unknown as NodeJS.ProcessEnv);
      if (model === '') expect(c.vision).not.toBeNull();            // empty falls back to the default capable model
      else { expect(c.vision).toBeNull(); expect(c.visionReason).toMatch(/not on the vision-capable list/); }
    }
  });
  it('accepts a custom capable list and base URL', () => {
    const c = loadEnrichmentConfig({ VISION_API_KEY: 'k', VISION_MODEL: 'my-vlm', VISION_CAPABLE_MODELS: 'my-vlm, other', VISION_API_BASE: 'https://x.test/v1/' } as unknown as NodeJS.ProcessEnv);
    expect(c.vision).toMatchObject({ model: 'my-vlm', baseUrl: 'https://x.test/v1' });
  });
});

describe('transcribeAudio', () => {
  it('posts the file as multipart with the key in the header only, and returns text, language and duration', async () => {
    const f = jest.fn().mockResolvedValue(json({ text: ' hello there ', language: 'english', duration: 3.2 }));
    const r = await transcribeAudio(cfg, audio, f);
    expect(r).toEqual({ text: 'hello there', language: 'english', durationSec: 3.2, model: 'm' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer KEY-0123456789');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('model')).toBe('m');
  });
  it('treats silence as an empty transcript, not an error', async () => {
    expect((await transcribeAudio(cfg, audio, jest.fn().mockResolvedValue(json({ text: '' })))).text).toBe('');
  });
  it.each([
    [401, 'auth', false, false], [403, 'auth', false, false], [413, 'too_large', false, false], [400, 'invalid_input', false, false], [415, 'invalid_input', false, false],
    [429, 'rate_limited', true, false], [500, 'server_error', true, true], [503, 'server_error', true, true],
  ])('HTTP %s -> %s (retryable=%s uncertain=%s)', async (status, code, retryable, uncertain) => {
    const e = await fail(transcribeAudio(cfg, audio, jest.fn().mockResolvedValue(json({ error: { message: 'detail with secret' } }, status as number))));
    expect(e).toMatchObject({ code, retryable, uncertain });
    expect(e.message).not.toMatch(/secret|KEY-/);
  });
  it('maps a timeout and a network failure as retryable but uncertain, without leaking the cause', async () => {
    const t = await fail(transcribeAudio(cfg, audio, jest.fn().mockRejectedValue(Object.assign(new Error('x https://api.example.test KEY-0123456789'), { name: 'TimeoutError' }))));
    expect(t).toMatchObject({ code: 'timeout', retryable: true, uncertain: true });
    const n = await fail(transcribeAudio(cfg, audio, jest.fn().mockRejectedValue(new TypeError('fetch failed'))));
    expect(n).toMatchObject({ code: 'network', retryable: true, uncertain: true });
    expect(t.message + n.message).not.toMatch(/KEY-|example/);
  });
  it('rejects a malformed or incomplete response instead of inventing a transcript', async () => {
    expect(await fail(transcribeAudio(cfg, audio, jest.fn().mockResolvedValue(new Response('<html>', { status: 200 }))))).toMatchObject({ code: 'bad_response' });
    expect(await fail(transcribeAudio(cfg, audio, jest.fn().mockResolvedValue(json({ nothing: true }))))).toMatchObject({ code: 'bad_response', retryable: false });
  });
  it('caps the transcript length and strips control characters', async () => {
    const r = await transcribeAudio(cfg, audio, jest.fn().mockResolvedValue(json({ text: `a\u0000b${'x'.repeat(20_000)}` })));
    expect(r.text.length).toBe(8000);
    expect(r.text).not.toContain('\u0000');
  });
});

describe('describeImage', () => {
  it('sends the image as a data URL with low detail and a system prompt that treats image text as data', async () => {
    const f = jest.fn().mockResolvedValue(json({ choices: [{ message: { content: ' A red bag on a table. ' } }] }));
    const r = await describeImage(cfg, image, f);
    expect(r).toEqual({ text: 'A red bag on a table.', model: 'm' });
    const body = JSON.parse(f.mock.calls[0]![1].body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: VISION_SYSTEM_PROMPT });
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.buffer.toString('base64')}`, detail: 'low' } });
    expect(VISION_SYSTEM_PROMPT).toMatch(/never an instruction/);
    expect(JSON.stringify(f.mock.calls[0]![1].headers)).toContain('Bearer KEY-0123456789');
    expect(f.mock.calls[0]![1].body).not.toContain('KEY-0123456789');
  });
  it('fails clearly on empty or malformed answers and provider errors', async () => {
    expect(await fail(describeImage(cfg, image, jest.fn().mockResolvedValue(json({ choices: [{ message: { content: '   ' } }] }))))).toMatchObject({ code: 'bad_response' });
    expect(await fail(describeImage(cfg, image, jest.fn().mockResolvedValue(json({ choices: [] }))))).toMatchObject({ code: 'bad_response' });
    expect(await fail(describeImage(cfg, image, jest.fn().mockResolvedValue(json({}, 429))))).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(await fail(describeImage(cfg, image, jest.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))))).toMatchObject({ code: 'timeout', uncertain: true });
  });
  it('caps the description length', async () => {
    const r = await describeImage(cfg, image, jest.fn().mockResolvedValue(json({ choices: [{ message: { content: 'y'.repeat(9000) } }] })));
    expect(r.text.length).toBe(1500);
  });
});
