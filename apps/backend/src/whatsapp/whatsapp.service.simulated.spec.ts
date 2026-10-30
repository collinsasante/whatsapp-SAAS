import { SimulatedRecipientError, simulatedPhoneFor } from '@whatsapp-platform/shared-utils';
import { WhatsAppService } from './whatsapp.service';

/**
 * The provider boundary: whatever calls a WhatsApp send method (a reply, a retry, a campaign, an automation, a human typing in the
 * Inbox), a simulated number is refused BEFORE credentials are read or any request is built.
 */
function build() {
  const post = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  const resolveCredentials = jest.fn().mockResolvedValue({ phoneNumberId: 'pn1', accessToken: 'token' });
  const getTenantCredentials = jest.fn().mockResolvedValue({ phoneNumberId: 'pn1', accessToken: 'token' });
  const getClient = jest.fn().mockReturnValue({ post });
  const service = Object.create(WhatsAppService.prototype) as WhatsAppService & Record<string, unknown>;
  Object.assign(service, { resolveCredentials, getTenantCredentials, getClient, logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() } });
  return { service, post, resolveCredentials, getTenantCredentials, getClient };
}

const SIMULATED = simulatedPhoneFor('user-1');
const REAL = '+233555000111';

/** Every send that takes a recipient, with the arguments after `to` it needs. */
const SENDERS: Array<[string, unknown[]]> = [
  ['sendTextMessage', ['hi']],
  ['sendMediaMessage', ['image', 'https://cdn.example/p.jpg', 'caption']],
  ['sendMediaMessageById', ['image', 'media-id', 'caption']],
  ['sendTemplateMessage', ['order_update', 'en', []]],
  ['sendLocationMessage', [5.6, -0.19, 'Accra', 'Ring Road']],
  ['sendContactMessage', ['Jane', '+233555000222']],
  ['sendReaction', ['wamid.9', '👍']],
  ['sendCsatSurvey', []],
];

describe('WhatsAppService refuses a simulated recipient before any credential or request', () => {
  it.each(SENDERS)('%s', async (method, rest) => {
    const { service, post, resolveCredentials, getTenantCredentials, getClient } = build();
    await expect((service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]('t1', SIMULATED, ...rest)).rejects.toBeInstanceOf(SimulatedRecipientError);
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(getTenantCredentials).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['+0003458935471', '0003458935471', '+000 345 893 5471', '000-345-893-5471'])('refuses the number however it is written (%s)', async (to) => {
    const { service, post } = build();
    await expect(service.sendTextMessage('t1', to, 'hi')).rejects.toBeInstanceOf(SimulatedRecipientError);
    expect(post).not.toHaveBeenCalled();
  });

  it('is an error that says why, not a silent success (so a caller can never mistake it for a delivery)', async () => {
    const { service } = build();
    await expect(service.sendTextMessage('t1', SIMULATED, 'hi')).rejects.toMatchObject({ name: 'SimulatedRecipientError', code: 'SIMULATED_RECIPIENT' });
  });

  describe('real recipients are unaffected', () => {
    it('a real number is sent to', async () => {
      const { service, post } = build();
      await expect(service.sendTextMessage('t1', REAL, 'hi')).resolves.toBe('wamid.1');
      expect(post).toHaveBeenCalledTimes(1);
    });

    it.each(['GH.1115168874544553', '+233000000000', '+2330001234567', '+0013458935471'])('and so is %s (not in the reserved range)', async (to) => {
      const { service, post } = build();
      await service.sendTextMessage('t1', to, 'hi');
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
