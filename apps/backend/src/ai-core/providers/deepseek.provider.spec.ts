import axios from 'axios';
import { DeepSeekProvider } from './deepseek.provider';
import { AiProviderError } from './ai-provider.interface';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    provider = new DeepSeekProvider();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    jest.clearAllMocks();
    jest.spyOn(global.Math, 'random').mockReturnValue(0); // deterministic retry jitter
  });

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalEnv;
    jest.restoreAllMocks();
  });

  it('maps a successful response, including usage and finish reason', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: '{"response":"hi","confidence":90}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      },
    });

    const result = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toBe('{"response":"hi","confidence":90}');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(result.provider).toBe('deepseek');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('maps tool calls when present', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: { content: null, tool_calls: [{ id: 'call_1', function: { name: 'get_order_status', arguments: '{}' } }] },
          finish_reason: 'tool_calls',
        }],
        usage: {},
      },
    });

    const result = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'get_order_status', arguments: '{}' }]);
  });

  it('throws a non-retryable auth error when the API key is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toMatchObject({
      code: 'auth', retryable: false,
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('classifies a timeout as retryable and retries once before throwing', async () => {
    mockedAxios.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' });

    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toMatchObject({
      code: 'timeout', retryable: true,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('classifies HTTP 429 as retryable rate_limited and retries once before throwing', async () => {
    mockedAxios.post.mockRejectedValue({ response: { status: 429 } });

    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toMatchObject({
      code: 'rate_limited', retryable: true,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry after one retryable failure', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} } });

    const result = await provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] });

    expect(result.content).toBe('ok');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('classifies HTTP 401 as non-retryable auth and does not retry', async () => {
    mockedAxios.post.mockRejectedValue({ response: { status: 401 } });

    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toMatchObject({
      code: 'auth', retryable: false,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // no retry for non-retryable errors
  });

  it('classifies a generic 4xx as non-retryable invalid_request', async () => {
    mockedAxios.post.mockRejectedValue({ response: { status: 400 } });

    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toMatchObject({
      code: 'invalid_request', retryable: false,
    });
  });

  it('rethrows an AiProviderError without reclassifying it', async () => {
    const original = new AiProviderError('parse_error', 'bad json', false);
    mockedAxios.post.mockRejectedValue(original);

    await expect(provider.complete({ modelKey: 'deepseek-v4-flash', messages: [] })).rejects.toBe(original);
  });

  it('sends jsonMode as response_format and tools as function defs when provided', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} } });

    await provider.complete({
      modelKey: 'deepseek-v4-flash',
      messages: [{ role: 'system', content: 'sys' }],
      jsonMode: true,
      tools: [{ name: 'get_order_status', description: 'check order', parameters: { type: 'object', properties: {} } }],
    });

    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body).toMatchObject({
      response_format: { type: 'json_object' },
      tool_choice: 'auto',
      tools: [{ type: 'function', function: { name: 'get_order_status' } }],
    });
  });
});
