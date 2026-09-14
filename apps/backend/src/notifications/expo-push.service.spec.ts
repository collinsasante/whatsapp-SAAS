import axios from 'axios';
import { ExpoPushService } from './expo-push.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ExpoPushService', () => {
  let service: ExpoPushService;

  beforeEach(() => {
    service = new ExpoPushService();
    jest.clearAllMocks();
  });

  it('does nothing and never calls the network for an empty token list', async () => {
    const result = await service.send([], { title: 't', body: 'b' });
    expect(result.invalidTokens).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('sends a real POST to the Expo push API with the given title/body/data', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [{ status: 'ok', id: 'ticket-1' }] } });
    await service.send(['ExponentPushToken[abc]'], { title: 'New message', body: 'Hi there', data: { conversationId: 'conv-1' } });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      [expect.objectContaining({ to: 'ExponentPushToken[abc]', title: 'New message', body: 'Hi there', data: { conversationId: 'conv-1' } })],
      expect.any(Object),
    );
  });

  it('collects tokens Expo reports as DeviceNotRegistered for pruning', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      ] },
    });
    const result = await service.send(['good-token', 'stale-token'], { title: 't', body: 'b' });
    expect(result.invalidTokens).toEqual(['stale-token']);
  });

  it('does not treat other ticket errors as invalid tokens to prune', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { data: [{ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } }] },
    });
    const result = await service.send(['token-1'], { title: 't', body: 'b' });
    expect(result.invalidTokens).toEqual([]);
  });

  it('never throws when the Expo API call itself fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('network down'));
    await expect(service.send(['token-1'], { title: 't', body: 'b' })).resolves.toEqual({ invalidTokens: [] });
  });

  it('splits more than 100 tokens into multiple batched requests', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [] } });
    const tokens = Array.from({ length: 150 }, (_, i) => `token-${i}`);
    await service.send(tokens, { title: 't', body: 'b' });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect((mockedAxios.post.mock.calls[0][1] as unknown[]).length).toBe(100);
    expect((mockedAxios.post.mock.calls[1][1] as unknown[]).length).toBe(50);
  });
});
