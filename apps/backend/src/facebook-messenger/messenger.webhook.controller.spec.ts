import { InternalServerErrorException } from '@nestjs/common';
import { MessengerWebhookController } from './messenger.webhook.controller';

function build(channels: Array<{ id: string; tenantId: string; externalId: string }>) {
  const messages = {
    handleInboundMessenger: jest.fn().mockResolvedValue({}),
    handleMessengerEcho: jest.fn().mockResolvedValue({ status: 'stored' }),
    handleMetaReceipt: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { channel: { findMany: jest.fn().mockResolvedValue(channels) } };
  const events = { recordReceived: jest.fn().mockResolvedValue('e1'), markOutcome: jest.fn().mockResolvedValue(undefined) };
  const controller = new MessengerWebhookController(prisma as never, messages as never, events as never);
  return { controller, messages, events, prisma };
}

const req = { rawBody: Buffer.from('{}') } as never;
const body = (messaging: object[], id = 'PAGE-1', object = 'page') => ({ object, entry: [{ id, time: 1, messaging }] } as never);

describe('MessengerWebhookController', () => {
  beforeEach(() => { delete process.env['FACEBOOK_APP_SECRET']; });

  it('routes a reply sent outside VerzChat to the echo handler with the customer (recipient) id, never as an inbound message', async () => {
    const { controller, messages } = build([{ id: 'ch1', tenantId: 't1', externalId: 'PAGE-1' }]);
    const echo = { sender: { id: 'PAGE-1' }, recipient: { id: 'PSID-9' }, timestamp: 5, message: { mid: 'mid.E', text: 'hi', is_echo: true, app_id: null } };
    await controller.receive(req, body([echo]), '');
    expect(messages.handleMessengerEcho).toHaveBeenCalledWith('t1', 'ch1', 'PSID-9', echo.message, 5, 'MESSENGER');
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });

  it('routes a customer message to the inbound handler with the customer as sender', async () => {
    const { controller, messages } = build([{ id: 'ch1', tenantId: 't1', externalId: 'PAGE-1' }]);
    const inbound = { sender: { id: 'PSID-9' }, recipient: { id: 'PAGE-1' }, timestamp: 5, message: { mid: 'mid.I', text: 'hello' } };
    await controller.receive(req, body([inbound]), '');
    expect(messages.handleInboundMessenger).toHaveBeenCalledWith('t1', 'ch1', 'PSID-9', inbound.message, 'MESSENGER');
    expect(messages.handleMessengerEcho).not.toHaveBeenCalled();
  });

  it('answers with an error when a message could not be stored, so Meta delivers it again, and records the failure', async () => {
    const { controller, messages, events } = build([{ id: 'ch1', tenantId: 't1', externalId: 'PAGE-1' }]);
    messages.handleInboundMessenger.mockRejectedValueOnce(new Error('db down'));
    const ev = { sender: { id: 'PSID-9' }, recipient: { id: 'PAGE-1' }, timestamp: 5, message: { mid: 'mid.I', text: 'hello' } };
    await expect(controller.receive(req, body([ev]), '')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(events.markOutcome).toHaveBeenCalledWith('e1', 'FAILED', expect.any(String));
  });

  it('a failed echo also fails the delivery, and the other events in it are still processed first', async () => {
    const { controller, messages } = build([{ id: 'ch1', tenantId: 't1', externalId: 'PAGE-1' }]);
    messages.handleMessengerEcho.mockRejectedValueOnce(new Error('db down'));
    const echo = { sender: { id: 'PAGE-1' }, recipient: { id: 'PSID-9' }, timestamp: 5, message: { mid: 'mid.E', text: 'x', is_echo: true } };
    const inbound = { sender: { id: 'PSID-9' }, recipient: { id: 'PAGE-1' }, timestamp: 6, message: { mid: 'mid.I', text: 'y' } };
    await expect(controller.receive(req, body([echo, inbound]), '')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(messages.handleInboundMessenger).toHaveBeenCalledTimes(1);
  });

  it('one account failing does not stop another account in the same delivery', async () => {
    const { controller, messages } = build([
      { id: 'chA', tenantId: 'tA', externalId: 'PAGE-A' },
      { id: 'chB', tenantId: 'tB', externalId: 'PAGE-B' },
    ]);
    messages.handleInboundMessenger.mockRejectedValueOnce(new Error('A is broken'));
    const mk = (page: string, mid: string) => ({ sender: { id: 'PSID' }, recipient: { id: page }, timestamp: 1, message: { mid, text: 't' } });
    const b = { object: 'page', entry: [{ id: 'PAGE-A', time: 1, messaging: [mk('PAGE-A', 'mid.A')] }, { id: 'PAGE-B', time: 1, messaging: [mk('PAGE-B', 'mid.B')] }] } as never;
    await expect(controller.receive(req, b, '')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(messages.handleInboundMessenger).toHaveBeenCalledWith('tB', 'chB', 'PSID', expect.objectContaining({ mid: 'mid.B' }), 'MESSENGER');
  });

  it('never mixes tenants: a Page connected to two workspaces stores each event under its own workspace', async () => {
    const { controller, messages } = build([
      { id: 'chA', tenantId: 'tA', externalId: 'PAGE-1' },
      { id: 'chB', tenantId: 'tB', externalId: 'PAGE-1' },
    ]);
    const ev = { sender: { id: 'PSID-9' }, recipient: { id: 'PAGE-1' }, timestamp: 5, message: { mid: 'mid.I', text: 'hello' } };
    await controller.receive(req, body([ev]), '');
    expect(messages.handleInboundMessenger.mock.calls.map((c) => c[0])).toEqual(['tA', 'tB']);
  });

  it('acknowledges events for an account that is not connected without storing anything', async () => {
    const { controller, messages } = build([]);
    const ev = { sender: { id: 'PSID-9' }, recipient: { id: 'PAGE-X' }, timestamp: 5, message: { mid: 'mid.I', text: 'hello' } };
    await expect(controller.receive(req, body([ev], 'PAGE-X'), '')).resolves.toEqual({ status: 'ok' });
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });

  it('rejects a bad signature when an app secret is configured, and a missing secret in production', async () => {
    const { controller, messages } = build([{ id: 'ch1', tenantId: 't1', externalId: 'PAGE-1' }]);
    process.env['FACEBOOK_APP_SECRET'] = 'shh';
    await expect(controller.receive(req, body([]), 'sha256=00')).rejects.toThrow('Invalid webhook signature');
    delete process.env['FACEBOOK_APP_SECRET'];
    const was = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    await expect(controller.receive(req, body([]), '')).rejects.toThrow('not configured');
    process.env['NODE_ENV'] = was;
    expect(messages.handleInboundMessenger).not.toHaveBeenCalled();
  });

  it('ignores payloads that are not for a Page or Instagram account, and malformed bodies', async () => {
    const { controller, prisma } = build([]);
    await expect(controller.receive(req, { object: 'user', entry: [] } as never, '')).resolves.toEqual({ status: 'ok' });
    await expect(controller.receive(req, { object: 'page' } as never, '')).resolves.toEqual({ status: 'ok' });
    expect(prisma.channel.findMany).not.toHaveBeenCalled();
  });

  it('handles Instagram echoes through the same path', async () => {
    const { controller, messages } = build([{ id: 'chIG', tenantId: 't1', externalId: 'IG-1' }]);
    const echo = { sender: { id: 'IG-1' }, recipient: { id: 'IGSID-4' }, timestamp: 5, message: { mid: 'mid.IG', text: 'hi', is_echo: true } };
    await controller.receive(req, body([echo], 'IG-1', 'instagram'), '');
    expect(messages.handleMessengerEcho).toHaveBeenCalledWith('t1', 'chIG', 'IGSID-4', echo.message, 5, 'INSTAGRAM');
  });
});
