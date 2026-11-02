import { assertProductionSecretsConfigured, describeMissingOptionalConfig } from './validate-production-secrets';

describe('assertProductionSecretsConfigured', () => {
  const ORIGINAL_ENV = process.env;

  const setRequiredInternalSecrets = () => {
    process.env['INTERNAL_SECRET'] = 'internal-secret-value';
    process.env['WHATSAPP_WEB_INTERNAL_API_KEY'] = 'ww-key-value';
    process.env['WHATSAPP_APP_SECRET'] = 'meta-app-secret';
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does nothing outside production, even with no secrets set', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_SECRET'];
    delete process.env['JWT_REFRESH_SECRET'];
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it('throws in production when JWT_SECRET is missing', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
    process.env['JWT_REFRESH_SECRET'] = 'a-real-refresh-secret';
    expect(() => assertProductionSecretsConfigured()).toThrow(/JWT_SECRET/);
  });

  it('throws in production when JWT_SECRET is still the hardcoded default', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'changeme';
    process.env['JWT_REFRESH_SECRET'] = 'a-real-refresh-secret';
    expect(() => assertProductionSecretsConfigured()).toThrow(/JWT_SECRET/);
  });

  it('throws in production when JWT_REFRESH_SECRET is still the hardcoded default', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-real-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'changeme-refresh';
    expect(() => assertProductionSecretsConfigured()).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('passes in production when both secrets are real values', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-real-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'a-real-refresh-secret';
    setRequiredInternalSecrets();
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });

  it.each(['INTERNAL_SECRET', 'WHATSAPP_WEB_INTERNAL_API_KEY', 'WHATSAPP_APP_SECRET'])('throws in production when %s is missing or empty, naming it but not any value', (name) => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'a-real-jwt-secret';
    process.env['JWT_REFRESH_SECRET'] = 'a-real-refresh-secret';
    setRequiredInternalSecrets();
    process.env[name] = '';
    expect(() => assertProductionSecretsConfigured()).toThrow(new RegExp(name));
    delete process.env[name];
    expect(() => assertProductionSecretsConfigured()).toThrow(new RegExp(name));
  });

  it('does not require optional payment providers to start, but reports which are missing by name only', () => {
    const report = describeMissingOptionalConfig({ PAYSTACK_SECRET_KEY: 'sk_live_super_secret' });
    expect(report.some((l) => l.startsWith('STRIPE_SECRET_KEY'))).toBe(true);
    expect(report.some((l) => l.startsWith('PAYSTACK_SECRET_KEY'))).toBe(false);
    expect(report.join('\n')).not.toContain('sk_live_super_secret');
  });
});
