import { renderPromptTemplate } from './prompt-render.util';

describe('renderPromptTemplate', () => {
  it('substitutes known variables', () => {
    const result = renderPromptTemplate('Hello {{name}}, welcome to {{business}}.', { name: 'Ama', business: 'VerzChat' });
    expect(result).toBe('Hello Ama, welcome to VerzChat.');
  });

  it('substitutes a missing variable with an empty string rather than leaving the placeholder', () => {
    const result = renderPromptTemplate('Instructions: {{tenant_instructions}}', {});
    expect(result).toBe('Instructions: ');
  });

  it('does not re-scan substituted values for further {{}} syntax (no injection via variable content)', () => {
    const result = renderPromptTemplate('Bio: {{bio}}', { bio: 'I love {{secret}} things' });
    expect(result).toBe('Bio: I love {{secret}} things');
  });

  it('supports the same variable appearing multiple times', () => {
    const result = renderPromptTemplate('{{name}} said hi. Bye, {{name}}!', { name: 'Kofi' });
    expect(result).toBe('Kofi said hi. Bye, Kofi!');
  });

  it('leaves plain text with no placeholders untouched', () => {
    expect(renderPromptTemplate('no placeholders here', { unused: 'x' })).toBe('no placeholders here');
  });
});
