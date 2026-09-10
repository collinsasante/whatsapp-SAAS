import { formatCurrentTimeContext } from './business-hours.util';

describe('formatCurrentTimeContext -- Verz-AI unification, Phase O', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('labels 09:00 in-timezone as morning', () => {
    // 2026-01-05 is a Monday. 09:00 UTC.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T09:00:00Z'));
    expect(formatCurrentTimeContext('UTC')).toContain('(morning)');
    expect(formatCurrentTimeContext('UTC')).toContain('Good morning');
  });

  it('labels 14:00 in-timezone as afternoon', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T14:00:00Z'));
    expect(formatCurrentTimeContext('UTC')).toContain('(afternoon)');
  });

  it('labels 18:00 in-timezone as evening -- this is the exact bug reported: "Good morning" was said in the evening', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T18:00:00Z'));
    const result = formatCurrentTimeContext('UTC');
    expect(result).toContain('(evening)');
    expect(result).not.toContain('Good morning');
  });

  it('labels 23:00 in-timezone as night and tells the model not to force a greeting', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T23:00:00Z'));
    const result = formatCurrentTimeContext('UTC');
    expect(result).toContain('late night');
    expect(result).not.toMatch(/Good (morning|afternoon|evening)/);
  });

  it('uses the given timezone, not the process timezone -- same instant, different tenant timezone, different day-part', () => {
    // 03:00 UTC on 2026-01-05 is 22:00 the previous day in America/New_York, but
    // still morning-ish (08:00) in a UTC+5 zone like Asia/Karachi.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T03:00:00Z'));
    const karachi = formatCurrentTimeContext('Asia/Karachi');
    const newYork = formatCurrentTimeContext('America/New_York');
    expect(karachi).toContain('(morning)');
    expect(newYork).toContain('late night');
  });

  it('falls back to UTC-consistent behavior when given "UTC" explicitly (the TenantSettings.timezone default)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T10:00:00Z'));
    expect(() => formatCurrentTimeContext('UTC')).not.toThrow();
  });
});
