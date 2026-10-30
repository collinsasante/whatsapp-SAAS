import { KbRelevantContextSource } from './knowledge-context.source';

function build(articles: Array<{ title: string; content: string }>, guidance: jest.Mock) {
  const kb = { getRelevant: jest.fn().mockResolvedValue(articles) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { source: new KbRelevantContextSource(kb as any, { getGuidanceBlock: guidance } as any), kb };
}

describe('KbRelevantContextSource', () => {
  it('returns the knowledge base followed by the reviewed guidance for the same tenant and message', async () => {
    const guidance = jest.fn().mockResolvedValue('\n\nREVIEWED GUIDANCE FROM THIS BUSINESS\n- x');
    const { source } = build([{ title: 'Hours', content: 'Open 9 to 5' }], guidance);
    const out = await source.getContext('tenant-a', 'when are you open', []);
    expect(guidance).toHaveBeenCalledWith('tenant-a', 'when are you open');
    expect(out).toMatch(/KNOWLEDGE BASE:\n## Hours\nOpen 9 to 5[\s\S]*REVIEWED GUIDANCE/);
  });

  it('returns only the guidance when the knowledge base has nothing relevant', async () => {
    const { source } = build([], jest.fn().mockResolvedValue('\n\nREVIEWED GUIDANCE FROM THIS BUSINESS\n- x'));
    expect(await source.getContext('t', 'q', [])).toContain('REVIEWED GUIDANCE');
  });

  it('returns an empty string when neither applies, as before', async () => {
    const { source } = build([], jest.fn().mockResolvedValue(''));
    expect(await source.getContext('t', 'q', [])).toBe('');
  });

  it('keeps the knowledge base when the guidance lookup fails', async () => {
    const { source } = build([{ title: 'Hours', content: 'Open 9 to 5' }], jest.fn().mockRejectedValue(new Error('down')));
    expect(await source.getContext('t', 'q', [])).toContain('Open 9 to 5');
  });
});
