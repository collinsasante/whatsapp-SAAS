import { assertProductionSecretsConfigured } from './validate-production-secrets';

describe('assertProductionSecretsConfigured', () => {
  const ORIGINAL_ENV = process.env;

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
    expect(() => assertProductionSecretsConfigured()).not.toThrow();
  });
});
