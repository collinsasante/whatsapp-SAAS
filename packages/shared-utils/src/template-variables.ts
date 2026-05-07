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
  components: Array<{ type: string; text?: string }>,
  variables: Record<string, string>,
): Array<{ type: string; parameters: Array<{ type: string; text: string }> }> {
  return components
    .filter((c) => c.text && c.text.includes('{{'))
    .map((c) => ({
      type: c.type.toLowerCase(),
      parameters: extractTemplateVariables(c.text!).map((varIndex) => ({
        type: 'text',
        text: variables[varIndex] ?? '',
      })),
    }));
}
