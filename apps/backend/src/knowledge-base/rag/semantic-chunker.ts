/**
 * Splits a document into chunks that end on sentence and paragraph boundaries, never in the middle of a sentence, with a configurable
 * overlap so a fact that straddles a boundary is still whole in at least one chunk. Pure and deterministic; no model call.
 *
 *  - Markdown headings start a new section; a chunk never spans two sections, and there is no overlap across a heading.
 *  - Paragraphs are packed greedily up to `targetChars`; a paragraph longer than `maxChars` is split at sentences, and a single
 *    sentence longer than `maxChars` is split at whitespace as a last resort.
 *  - A short document (<= maxChars) is a single chunk, exactly as written.
 *  - A trailing fragment smaller than `minChars` is merged into the previous chunk of its section when it fits.
 */
export interface ChunkOptions {
  targetChars: number;
  maxChars: number;
  overlapChars: number;
  minChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetChars: 800, maxChars: 1200, overlapChars: 120, minChars: 150 };

export interface Chunk {
  index: number;
  heading: string | null;
  text: string;
}

export function resolveChunkOptions(partial: Partial<ChunkOptions> = {}): ChunkOptions {
  const o = { ...DEFAULT_CHUNK_OPTIONS, ...partial };
  if (![o.targetChars, o.maxChars, o.overlapChars, o.minChars].every((n) => Number.isFinite(n) && n >= 0)) throw new RangeError('chunk options must be finite, non-negative numbers');
  if (o.targetChars < 50) throw new RangeError('targetChars must be at least 50');
  if (o.maxChars < o.targetChars) throw new RangeError('maxChars must be at least targetChars');
  if (o.overlapChars >= o.targetChars) throw new RangeError('overlapChars must be smaller than targetChars');
  return o;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SENTENCE_BREAK = /(?<=[.!?])["')\]]*\s+/;

interface Atom {
  text: string;
  /** What precedes this atom when it follows another in the same chunk. */
  sep: '\n\n' | ' ';
}

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_BREAK).map((s) => s.trim()).filter(Boolean);
}

function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars / 2) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function atomsOf(paragraph: string, maxChars: number): Atom[] {
  if (paragraph.length <= maxChars) return [{ text: paragraph, sep: '\n\n' }];
  const atoms: Atom[] = [];
  for (const sentence of splitSentences(paragraph)) {
    const pieces = sentence.length > maxChars ? hardSplit(sentence, maxChars) : [sentence];
    for (const piece of pieces) atoms.push({ text: piece, sep: atoms.length === 0 ? '\n\n' : ' ' });
  }
  return atoms;
}

/** The last whole sentences of a chunk, up to roughly `overlapChars`, to seed the next chunk. */
function overlapTail(chunkText: string, overlapChars: number): string {
  if (overlapChars <= 0) return '';
  const sentences = splitSentences(chunkText);
  const picked: string[] = [];
  let total = 0;
  for (let i = sentences.length - 1; i >= 1; i--) { // i >= 1: never repeat the whole chunk
    if (total + sentences[i].length > overlapChars * 1.5) break;
    picked.unshift(sentences[i]);
    total += sentences[i].length + 1;
    if (total >= overlapChars) break;
  }
  return picked.join(' ');
}

interface Section {
  heading: string | null;
  paragraphs: string[];
}

function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, paragraphs: [] };
  let buffer: string[] = [];
  const flushBuffer = () => {
    const joined = buffer.join('\n').trim();
    if (joined) current.paragraphs.push(...joined.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      flushBuffer();
      if (current.paragraphs.length > 0 || current.heading !== null) sections.push(current);
      current = { heading: heading[2].trim(), paragraphs: [] };
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  if (current.paragraphs.length > 0 || sections.length === 0) sections.push(current);
  return sections.filter((s) => s.paragraphs.length > 0);
}

export function chunkDocument(raw: string, options: Partial<ChunkOptions> = {}): Chunk[] {
  const o = resolveChunkOptions(options);
  const text = (raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  if (text.length <= o.maxChars) return [{ index: 0, heading: null, text }];

  const chunks: Chunk[] = [];
  for (const section of sectionsOf(text)) {
    const atoms = section.paragraphs.flatMap((p) => atomsOf(p, o.maxChars));
    const sectionChunks: string[] = [];
    let current = '';
    let hasNew = false;

    const flush = () => {
      if (hasNew && current.trim()) sectionChunks.push(current.trim());
      current = '';
      hasNew = false;
    };

    for (const atom of atoms) {
      const joined = current ? current + atom.sep + atom.text : atom.text;
      if (current && hasNew && joined.length > o.targetChars && current.length >= o.minChars) {
        const previous = current;
        flush();
        const seed = overlapTail(previous, o.overlapChars);
        current = seed && seed.length + atom.text.length + 2 <= o.maxChars ? seed + '\n\n' + atom.text : atom.text;
      } else {
        current = joined;
      }
      hasNew = true;
    }
    flush();

    // A tiny last chunk joins the one before it when the result still fits, so no chunk is a stray fragment.
    if (sectionChunks.length > 1) {
      const last = sectionChunks[sectionChunks.length - 1];
      const before = sectionChunks[sectionChunks.length - 2];
      if (last.length < o.minChars && before.length + 2 + last.length <= o.maxChars * 1.25) {
        sectionChunks.splice(sectionChunks.length - 2, 2, before + '\n\n' + last);
      }
    }
    for (const t of sectionChunks) chunks.push({ index: chunks.length, heading: section.heading, text: t });
  }
  return chunks.length > 0 ? chunks : [{ index: 0, heading: null, text }];
}
