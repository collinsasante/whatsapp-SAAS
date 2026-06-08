export function interpolateTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, index) => {
    const key = index.toString();
    return variables[key] ?? match;
  });
}

export function extractTemplateVariables(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, '')))];
}

export function buildTemplateComponents(
  components: Array<{ type: string; text?: string; buttons?: Array<{ type: string; url?: string; text?: string }> }>,
  variables: Record<string, string>,
  urlVariables?: Record<string, string>,
): Array<unknown> {
  // If caller passed named keys (e.g. { orderID: "..." }) instead of numeric ones
  // (e.g. { "1": "..." }), remap them positionally so {{1}} gets the first value, etc.
  const normalise = (v: Record<string, string>): Record<string, string> => {
    const hasNumeric = Object.keys(v).some((k) => /^\d+$/.test(k));
    return hasNumeric
      ? v
      : Object.fromEntries(Object.values(v).map((val, i) => [(i + 1).toString(), val]));
  };

  const vars = normalise(variables);
  // urlVariables override the body vars for URL button parameters; fall back to body vars.
  const urlVars = urlVariables ? normalise(urlVariables) : vars;

  const result: Array<unknown> = [];

  for (const c of components) {
    if (c.text && c.text.includes('{{')) {
      result.push({
        type: c.type.toLowerCase(),
        parameters: extractTemplateVariables(c.text).map((varIndex) => ({
          type: 'text',
          text: vars[varIndex] ?? '',
        })),
      });
    } else if (c.type.toUpperCase() === 'BUTTONS' && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn, idx) => {
        if (btn.url && btn.url.includes('{{')) {
          result.push({
            type: 'button',
            sub_type: 'url',
            index: idx,
            parameters: extractTemplateVariables(btn.url).map((varIndex) => ({
              type: 'text',
              text: urlVars[varIndex] ?? '',
            })),
          });
        }
      });
    }
  }

  return result;
}
