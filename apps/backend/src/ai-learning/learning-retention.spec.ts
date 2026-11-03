import { UnauthorizedException } from '@nestjs/common';
import { AiLearningRetentionController } from './learning-retention.controller';
import { AiLearningRetentionService, DEFAULT_FREE_TEXT_DAYS, DEFAULT_METRICS_MONTHS, RETENTION_MANIFEST, loadRetentionSettings } from './learning-retention.service';

describe('retention settings', () => {
  it('is DISABLED by default, with 90 days for free text and 13 months for metrics', () => {
    expect(loadRetentionSettings({})).toEqual({ enabled: false, freeTextDays: 90, metricsMonths: 13 });
    expect([DEFAULT_FREE_TEXT_DAYS, DEFAULT_METRICS_MONTHS]).toEqual([90, 13]);
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on', ' true', 'true '])('only the exact string "true" enables it (%j does not)', (value) => {
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_ENABLED: value }).enabled).toBe(false);
  });

  it('is enabled by exactly "true", and ignores invalid periods', () => {
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_ENABLED: 'true' }).enabled).toBe(true);
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '30', AI_LEARNING_RETENTION_METRICS_MONTHS: '6' })).toMatchObject({ freeTextDays: 30, metricsMonths: 6 });
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '-1', AI_LEARNING_RETENTION_METRICS_MONTHS: 'abc' })).toMatchObject({ freeTextDays: 90, metricsMonths: 13 });
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '1.5', AI_LEARNING_RETENTION_METRICS_MONTHS: '0' })).toMatchObject({ freeTextDays: 90, metricsMonths: 13 });
  });

  it.each([[''], ['  '], ['abc'], ['-1'], ['1.5'], ['0'], ['1e3'], ['0x10'], ['Infinity'], ['NaN'], ['99999999999999999999'], ['3651']])('a missing or invalid free-text period %j falls back to the proposed default', (value) => {
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: value }).freeTextDays).toBe(90);
  });

  it.each([[''], ['abc'], ['-1'], ['0'], ['121'], ['1e2'], ['1.5']])('a missing or invalid metrics period %j falls back to the proposed default', (value) => {
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_METRICS_MONTHS: value }).metricsMonths).toBe(13);
  });

  it('accepts the documented bounds exactly', () => {
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '3650', AI_LEARNING_RETENTION_METRICS_MONTHS: '120' })).toMatchObject({ freeTextDays: 3650, metricsMonths: 120 });
    expect(loadRetentionSettings({ AI_LEARNING_RETENTION_FREE_TEXT_DAYS: '1', AI_LEARNING_RETENTION_METRICS_MONTHS: '1' })).toMatchObject({ freeTextDays: 1, metricsMonths: 1 });
  });

  it('with EVERY variable missing or blank, retention is off and nothing else is enabled', () => {
    for (const env of [{}, { AI_LEARNING_RETENTION_ENABLED: '' }, { AI_LEARNING_RETENTION_ENABLED: 'false' }, { AI_LEARNING_RETENTION_ENABLED: undefined }]) {
      expect(loadRetentionSettings(env as NodeJS.ProcessEnv)).toEqual({ enabled: false, freeTextDays: 90, metricsMonths: 13 });
    }
  });

  it('never lists approved guidance, the cost ledger, credits, audit logs or Digital Self data as eligible', () => {
    const tables = new Set<string>(RETENTION_MANIFEST.map((r) => r.table));
    for (const forbidden of ['ai_learning_usage', 'ai_credit_transactions', 'ai_credit_reservations', 'ai_learning_audit_logs', 'digital_selves', 'digital_self_learning_events', 'ai_learning_settings']) {
      expect(tables.has(forbidden)).toBe(false);
    }
    const examples = RETENTION_MANIFEST.filter((r) => r.table === 'ai_training_examples');
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({ unless: 'status is APPROVED' });
  });
});

describe('AiLearningRetentionController', () => {
  const retention = { run: jest.fn().mockResolvedValue({ enabled: false }) };
  const controller = (secret: string | undefined) => new AiLearningRetentionController(retention as unknown as AiLearningRetentionService, { get: (_k: string, d: string) => secret ?? d } as never);
  beforeEach(() => retention.run.mockClear());

  it.each([[undefined], [''], ['wrong']])('refuses a call with header %j when a secret is configured', async (header) => {
    await expect(controller('s3cret').run(header)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(retention.run).not.toHaveBeenCalled();
  });

  it('fails closed when no INTERNAL_SECRET is configured, even for an empty header', async () => {
    await expect(controller(undefined).run('')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller(undefined).run(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(retention.run).not.toHaveBeenCalled();
  });

  it('runs the sweep (which does nothing while disabled) for the right secret', async () => {
    await expect(controller('s3cret').run('s3cret')).resolves.toEqual({ enabled: false });
    expect(retention.run).toHaveBeenCalledTimes(1);
  });
});
