import { formatHandoffBlock } from './handoff-context';

describe('formatHandoffBlock', () => {
  it('adds nothing when no handoff was performed', () => {
    expect(formatHandoffBlock(undefined)).toBe('');
  });

  it('after a successful handoff: states it as verified, forbids offering a person again and forbids invented specifics', () => {
    const block = formatHandoffBlock('requested');
    expect(block).toMatch(/verified by the system, not by you/);
    expect(block).toMatch(/have been notified/);
    expect(block).toMatch(/the one case where you may say the team has been notified/);
    expect(block).toMatch(/Do NOT offer, suggest or ask whether they would like to speak with a person/);
    expect(block).toMatch(/Do not promise a time, a name or any specific action/);
  });

  it('after a failed handoff: forbids any claim that someone was notified or will follow up, and asks for honesty', () => {
    const block = formatHandoffBlock('failed');
    expect(block).toMatch(/could NOT reach the team/);
    expect(block).toMatch(/Do NOT say or imply that anyone has been notified/);
    expect(block).toMatch(/do not promise that anyone will follow up/);
    expect(block).toMatch(/Be honest/);
    expect(block).not.toMatch(/have been notified\./);
  });

  it('is an instruction to the model: it contains no sentence written for the customer', () => {
    for (const outcome of ['requested', 'failed'] as const) {
      expect(formatHandoffBlock(outcome)).not.toMatch(/connecting you|team member who can help|trouble on my end/i);
    }
  });
});
