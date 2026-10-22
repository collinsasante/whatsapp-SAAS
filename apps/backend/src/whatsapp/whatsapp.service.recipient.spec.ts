import { WhatsAppService } from './whatsapp.service';

/** Captures the exact JSON body the service would POST to Meta's /messages endpoint. */
function build() {
  const post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  const service = Object.create(WhatsAppService.prototype) as WhatsAppService & Record<string, unknown>;
  Object.assign(service, {
    resolveCredentials: jest.fn().mockResolvedValue({ phoneNumberId: 'pn1', accessToken: 'token' }),
    getClient: jest.fn().mockReturnValue({ post }),
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
  });
  return { service, post };
}

const body = (post: jest.Mock) => post.mock.calls[0][1] as Record<string, unknown>;

describe('WhatsAppService addressing', () => {
  it('sends a text to a phone number in `to`', async () => {
    const { service, post } = build();
    await service.sendTextMessage('t1', '+233555000111', 'hi');
    expect(body(post)).toMatchObject({ to: '+233555000111', type: 'text' });
    expect(body(post)).not.toHaveProperty('recipient');
  });

  it('sends a text to a username customer by Business-Scoped User ID in `recipient`, with no `to`', async () => {
    const { service, post } = build();
    await service.sendTextMessage('t1', 'GH.1115168874544553', 'hi');
    expect(body(post)).toMatchObject({ recipient: 'GH.1115168874544553', type: 'text' });
    expect(body(post)).not.toHaveProperty('to');
  });

  it('uses `recipient` for a reaction as well, which the server hand edit had missed', async () => {
    const { service, post } = build();
    await service.sendReaction('t1', 'GH.1115168874544553', 'wamid.9', '👍');
    expect(body(post)).toMatchObject({ recipient: 'GH.1115168874544553', type: 'reaction' });
    expect(body(post)).not.toHaveProperty('to');
  });
});
