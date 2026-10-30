import { describeModelResponse } from './model-output.util';

describe('describeModelResponse', () => {
  it('describes an empty answer that still spent tokens, without any text', () => {
    const reasoning = 'The customer asks about delivery to Accra, which costs GHS 30...';
    const data = {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '', reasoning_content: reasoning } }],
      usage: { completion_tokens: 140, completion_tokens_details: { reasoning_tokens: 130 } },
    };
    const line = describeModelResponse(data);
    expect(line).toBe(`finish_reason=stop completion_tokens=140 reasoning_tokens=130 content_chars=0 reasoning_chars=${reasoning.length} tool_calls=0`);
    expect(line).not.toMatch(/Accra|delivery|customer/);
  });
  it('tells a cut-off answer from an empty one', () => {
    const cut = '{"response":"Deliv';
    expect(describeModelResponse({ choices: [{ finish_reason: 'length', message: { content: cut } }], usage: { completion_tokens: 400 } }))
      .toBe(`finish_reason=length completion_tokens=400 reasoning_tokens=n/a content_chars=${cut.length} reasoning_chars=absent tool_calls=0`);
  });
  it('copes with a missing or malformed response body without throwing', () => {
    for (const bad of [undefined, null, 'oops', 5, {}, { choices: [] }, { choices: [null] }]) expect(() => describeModelResponse(bad)).not.toThrow();
    expect(describeModelResponse({})).toBe('no choices in the response');
    expect(describeModelResponse({ choices: [{ message: null }] })).toMatch(/content_chars=absent/);
  });
});
