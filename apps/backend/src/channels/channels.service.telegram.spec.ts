import { BadRequestException } from '@nestjs/common';
import { ChannelsService } from './channels.service';

const BOT_TOKEN = '123456:TELEGRAM-BOT-TOKEN-SECRET';
const reply = (body: unknown) => ({ json: () => Promise.resolve(body) });

function build() {
  const prisma = { channel: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c1', ...data })), update: jest.fn() } };
  const config = { get: jest.fn() };
  const encryption = { encrypt: jest.fn((v: string) => `enc:v1:${Buffer.from(v).toString('base64')}`), decrypt: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ChannelsService(prisma as any, config as any, {} as any, encryption as any, audit as any), prisma, encryption };
}

describe('ChannelsService.connectTelegramBot credential handling', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('stores the bot token encrypted, uses Telegram\'s numeric bot id as the identity, and the token appears nowhere else in the row', async () => {
    global.fetch = jest.fn().mockResolvedValue(reply({ ok: true, result: { id: 777, username: 'shop_bot' } })) as never;
    const { service, prisma } = build();
    await service.connectTelegramBot('t1', BOT_TOKEN, 'u1');
    const data = prisma.channel.create.mock.calls[0][0].data;
    expect(data.externalId).toBe('777');
    expect(data.credentials.botToken).toMatch(/^enc:v1:/);
    expect(JSON.stringify({ ...data, credentials: { ...data.credentials, botToken: '[stored encrypted]' } })).not.toContain(BOT_TOKEN);
  });

  it('REGRESSION: if Telegram returns no bot id the token is refused, never used as the identifier', async () => {
    global.fetch = jest.fn().mockResolvedValue(reply({ ok: true, result: { username: 'shop_bot' } })) as never;
    const { service, prisma } = build();
    await expect(service.connectTelegramBot('t1', BOT_TOKEN)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.channel.create).not.toHaveBeenCalled();
  });
});
