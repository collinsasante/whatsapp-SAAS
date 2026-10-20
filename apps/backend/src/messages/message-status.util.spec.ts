import { shouldApplyStatus } from './message-status.util';

describe('shouldApplyStatus', () => {
  it('moves forward only', () => {
    expect(shouldApplyStatus('SENT', 'DELIVERED')).toBe(true);
    expect(shouldApplyStatus('DELIVERED', 'READ')).toBe(true);
    expect(shouldApplyStatus('SENT', 'READ')).toBe(true);
  });
  it('ignores duplicate and regressing receipts', () => {
    expect(shouldApplyStatus('DELIVERED', 'DELIVERED')).toBe(false);
    expect(shouldApplyStatus('READ', 'DELIVERED')).toBe(false);
    expect(shouldApplyStatus('DELIVERED', 'SENT')).toBe(false);
  });
  it('accepts FAILED only before delivery and never revives FAILED', () => {
    expect(shouldApplyStatus('SENT', 'FAILED')).toBe(true);
    expect(shouldApplyStatus('QUEUED', 'FAILED')).toBe(true);
    expect(shouldApplyStatus('DELIVERED', 'FAILED')).toBe(false);
    expect(shouldApplyStatus('FAILED', 'DELIVERED')).toBe(false);
  });
});
