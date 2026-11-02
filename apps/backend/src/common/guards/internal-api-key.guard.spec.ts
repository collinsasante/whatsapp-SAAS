import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalApiKeyGuard } from './internal-api-key.guard';

const ctx = (headers: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;
const guard = (env: Record<string, string | undefined>) => new InternalApiKeyGuard({ get: (k: string) => env[k] } as unknown as ConfigService);

describe('InternalApiKeyGuard', () => {
  it('admits the configured key', () => {
    expect(guard({ WHATSAPP_WEB_INTERNAL_API_KEY: 'k' }).canActivate(ctx({ 'x-internal-api-key': 'k' }))).toBe(true);
  });
  it.each([
    ['missing header', {}],
    ['empty header', { 'x-internal-api-key': '' }],
    ['wrong key', { 'x-internal-api-key': 'x' }],
    ['array header', { 'x-internal-api-key': ['k'] }],
  ])('refuses %s', (_n, headers) => {
    expect(() => guard({ WHATSAPP_WEB_INTERNAL_API_KEY: 'k' }).canActivate(ctx(headers))).toThrow(UnauthorizedException);
  });
  it.each([['development'], ['test'], ['production'], [undefined]])('fails closed with no configured key (NODE_ENV=%s)', (nodeEnv) => {
    for (const key of [undefined, '']) {
      expect(() => guard({ WHATSAPP_WEB_INTERNAL_API_KEY: key, NODE_ENV: nodeEnv }).canActivate(ctx({ 'x-internal-api-key': '' }))).toThrow(UnauthorizedException);
      expect(() => guard({ WHATSAPP_WEB_INTERNAL_API_KEY: key, NODE_ENV: nodeEnv }).canActivate(ctx({ 'x-internal-api-key': 'anything' }))).toThrow(UnauthorizedException);
    }
  });
});
