/**
 * Splits a KB article into retrieval-sized chunks: heading-aware (splits on
 * markdown-style headings or blank-line paragraph breaks first), then further
 * splits any oversized section into ~300-500 "token" chunks with overlap, so
 * a fact near a chunk boundary isn't lost entirely from one side.
 *
 * No tokenizer dependency -- uses the standard ~4 chars/token heuristic for
 * English, which is precise enough for chunk sizing (this governs retrieval
 * granularity, not a hard model context limit).
 */
const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 60;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export interface Chunk {
  heading: string | null;
  content: string;
}

interface Section {
  heading: string | null;
  body: string;
}

function splitIntoSections(text: string): Section[] {
  const headingPattern = /^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 /&'-]{2,60}:)$/gm;
  const matches = [...text.matchAll(headingPattern)];

  if (matches.length === 0) {
    // No detectable headings -- fall back to paragraph breaks as section boundaries.
    return text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((body) => ({ heading: null, body }));
  }

  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const heading = matches[i][0].replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();
    const body = text.slice(start, end).trim();
    if (body) sections.push({ heading, body });
  }

  // Anything before the first heading is still real content -- keep it, unheaded.
  const preamble = text.slice(0, matches[0].index!).trim();
  if (preamble) sections.unshift({ heading: null, body: preamble });

  return sections;
}

function splitLongSection(body: string): string[] {
  if (body.length <= TARGET_CHARS) return [body];
  const parts: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + TARGET_CHARS, body.length);
    if (end < body.length) {
      const lastSpace = body.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    parts.push(body.slice(start, end).trim());
    if (end >= body.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return parts.filter(Boolean);
}

export function chunkArticle(title: string, content: string): Chunk[] {
  const sections = splitIntoSections(content);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const parts = splitLongSection(section.body);
    for (const part of parts) {
      // Prefix the title so a chunk retrieved in isolation still carries its
      // article's identity (helps both the model and the FTS/embedding match).
      const content = section.heading ? `${title} — ${section.heading}\n${part}` : `${title}\n${part}`;
      chunks.push({ heading: section.heading, content });
    }
  }

  return chunks.length > 0 ? chunks : [{ heading: null, content: `${title}\n${content}`.trim() }];
}
