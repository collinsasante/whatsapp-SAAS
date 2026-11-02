import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The AI never speaks a fixed sentence to a customer. Every customer-facing AI reply is written by the model in the workspace's
 * voice, or not sent at all. This fails if one of the retired canned sentences comes back into production code.
 */
const BANNED: Array<[string, RegExp]> = [
  ['guard refusal', /I'm here to help with questions about/i],
  ['commerce guard refusal', /I'm here to help you shop/i],
  ['provider-failure apology', /having a little trouble on my end/i],
  ['holding line', /Let me get someone to pick this up/i],
  ['handoff-failed apology', /trouble connecting you to the right person/i],
  ['max-iterations line', /Let me get a team member to help finish this up/i],
  ['human-request line', /I'm connecting you with a team member/i],
  ['scripted gap reply', /That's a great question! Our team will follow up/i],
];

/** The retired V1_0_0 prompt body is kept only to recognise an untouched stored prompt (see prompts.service.ts), and retired-wording.ts
 * holds the patterns that detect and refuse to serve such wording. */
const ALLOWED_FILES = [/responder-system\.v1\.ts$/, /injection-patterns\.ts$/, /response-rules\.ts$/, /retired-wording\.ts$/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') && !/\/quality\//.test(path) ? [path] : [];
  });
}

describe('no canned customer-facing AI replies', () => {
  const root = join(__dirname, '..', '..');
  const files = sourceFiles(root).filter((f) => !ALLOWED_FILES.some((a) => a.test(f)));

  it.each(BANNED)('%s does not exist in production code', (_label, pattern) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, 'src'));
    expect(hits).toEqual([]);
  });

  it('no prompt tells the model to recite a fixed sentence', () => {
    const hits = files.filter((f) => /respond ONLY with:/i.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, 'src'));
    expect(hits).toEqual([]);
  });
});

describe('no prompt hands the model a phrase to recite', () => {
  const root = join(__dirname, '..', '..');
  const files = sourceFiles(root).filter((f) => /prompts\/|commerce-ai\.service|ai-responder\.service|security-refusal/.test(f) && !/retired-wording|responder-system\.v1/.test(f));

  // A quoted sentence that follows an instruction to say/reply/respond/answer/tell is wording the model will copy word for word.
  const RECITE = /\b(?:say|reply|respond|answer|tell (?:them|the customer)|write)\b[^.\n`]{0,25}:?\s*["“][A-Z][^"”]{15,}["”]/;

  // "Don't say '...'" names wording to AVOID, which is the opposite of handing the model a line to use.
  const withoutProhibitions = (text: string) => text.replace(/\b(?:don'?t|do not|never|must not|should not)\s+(?:say|reply|respond|answer|write)\b/gi, '');

  it('contains no instruction to say a quoted sentence', () => {
    const hits = files.filter((f) => RECITE.test(withoutProhibitions(readFileSync(f, 'utf8')))).map((f) => f.replace(root, 'src'));
    expect(hits).toEqual([]);
  });

  it('gives no example phrase for handing over to a colleague (models repeat such examples as stock lines)', () => {
    const hits = files.filter((f) => /let me get someone who handles that|I'll get my colleague on this/i.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, 'src'));
    expect(hits).toEqual([]);
  });
});
