/**
 * BERT "uncased" WordPiece tokenizer, built from the `tokenizer.json` that ships with all-MiniLM-L6-v2. It reproduces what the Hugging Face
 * tokenizer does for this model (clean text, space out CJK characters, lowercase, strip accents, split on whitespace and punctuation,
 * greedy longest-match WordPiece, [CLS] ... [SEP]) so the backend needs no tokenizer dependency. Its output is checked token-for-token
 * against the reference tokenizer in the model-backed test.
 */
export interface TokenizerFile {
  normalizer?: { type?: string; lowercase?: boolean; strip_accents?: boolean | null };
  model?: { type?: string; vocab?: Record<string, number>; unk_token?: string; continuing_subword_prefix?: string; max_input_chars_per_word?: number };
}

export interface EncodedText {
  /** Token ids, always starting with [CLS] and ending with [SEP]. */
  ids: number[];
}

const isAsciiPunctuation = (code: number) => (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
const PUNCTUATION = /^\p{P}$/u;
const isPunctuation = (ch: string) => isAsciiPunctuation(ch.codePointAt(0)!) || PUNCTUATION.test(ch);
const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /^\p{Zs}$/u.test(ch);
const isControl = (ch: string) => ch !== '\t' && ch !== '\n' && ch !== '\r' && /^[\p{Cc}\p{Cf}]$/u.test(ch);
const isCjk = (cp: number) =>
  (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f) ||
  (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unkId: number;
  private readonly clsId: number;
  private readonly sepId: number;
  private readonly prefix: string;
  private readonly maxWordChars: number;
  private readonly lowercase: boolean;

  constructor(file: TokenizerFile, private readonly maxTokens = 256) {
    const model = file.model;
    if (!model || model.type !== 'WordPiece' || !model.vocab) throw new Error('tokenizer.json is not a WordPiece tokenizer');
    this.vocab = new Map(Object.entries(model.vocab));
    const id = (token: string): number => {
      const found = this.vocab.get(token);
      if (found === undefined) throw new Error(`tokenizer vocabulary has no ${token} token`);
      return found;
    };
    this.unkId = id(model.unk_token ?? '[UNK]');
    this.clsId = id('[CLS]');
    this.sepId = id('[SEP]');
    this.prefix = model.continuing_subword_prefix ?? '##';
    this.maxWordChars = model.max_input_chars_per_word ?? 100;
    this.lowercase = file.normalizer?.lowercase !== false;
    if (maxTokens < 3) throw new Error('maxTokens must leave room for [CLS] and [SEP]');
  }

  get vocabSize(): number {
    return this.vocab.size;
  }

  encode(text: string): EncodedText {
    const ids = [this.clsId];
    const budget = this.maxTokens - 1; // leave room for [SEP]
    outer: for (const word of this.preTokenize(this.normalize(text))) {
      for (const id of this.wordPiece(word)) {
        if (ids.length >= budget) break outer;
        ids.push(id);
      }
    }
    ids.push(this.sepId);
    return { ids };
  }

  private normalize(text: string): string {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      out += isWhitespace(ch) ? ' ' : isCjk(cp) ? ` ${ch} ` : ch;
    }
    if (this.lowercase) out = out.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
    return out;
  }

  private preTokenize(text: string): string[] {
    const words: string[] = [];
    let current = '';
    const flush = () => { if (current) { words.push(current); current = ''; } };
    for (const ch of text) {
      if (ch === ' ') flush();
      else if (isPunctuation(ch)) { flush(); words.push(ch); }
      else current += ch;
    }
    flush();
    return words;
  }

  private wordPiece(word: string): number[] {
    const chars = Array.from(word);
    if (chars.length > this.maxWordChars) return [this.unkId];
    const pieces: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const candidate = (start > 0 ? this.prefix : '') + chars.slice(start, end).join('');
        found = this.vocab.get(candidate);
        if (found !== undefined) break;
        end--;
      }
      if (found === undefined) return [this.unkId];
      pieces.push(found);
      start = end;
    }
    return pieces;
  }
}
