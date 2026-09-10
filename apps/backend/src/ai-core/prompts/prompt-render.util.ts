/**
 * Renders a {{variable}} template. Deliberately a single, non-recursive pass:
 * substituted values are never re-scanned for `{{...}}` syntax, so a customer's
 * knowledge-base content or tenant instructions can never inject a *new*
 * template variable into the rendered prompt.
 */
export function renderPromptTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = variables[name];
    return value !== undefined ? value : '';
  });
}
