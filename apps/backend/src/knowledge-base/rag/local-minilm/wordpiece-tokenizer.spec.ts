import * as fs from 'fs';
import * as path from 'path';
import { TokenizerFile, WordPieceTokenizer } from './wordpiece-tokenizer';

const TOKENS = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'open', 'hours', '##s', 'park', '##ing', 'cafe', ',', '?', '$', '3', '.', '20', '你', '好', 'un', '##believ', '##able', 'a'];
const file = (over: Partial<TokenizerFile> = {}): TokenizerFile => ({ normalizer: { lowercase: true }, model: { type: 'WordPiece', vocab: Object.fromEntries(TOKENS.map((t, i) => [t, i])), unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 100 }, ...over });
const id = (t: string) => TOKENS.indexOf(t);
const CLS = id('[CLS]'), SEP = id('[SEP]'), UNK = id('[UNK]');
const encode = (text: string, max = 256) => new WordPieceTokenizer(file(), max).encode(text).ids;

describe('WordPieceTokenizer (logic, with a tiny vocabulary)', () => {
  it('wraps the text in [CLS] ... [SEP] and splits words into the longest known pieces', () => {
    expect(encode('Open hours parking')).toEqual([CLS, id('open'), id('hours'), id('park'), id('##ing'), SEP]);
  });

  it('lowercases and strips accents', () => {
    expect(encode('CAFÉ')).toEqual([CLS, id('cafe'), SEP]);
  });

  it('gives each punctuation mark and symbol its own token, including ASCII symbols such as $', () => {
    expect(encode('hours,open?')).toEqual([CLS, id('hours'), id(','), id('open'), id('?'), SEP]);
    expect(encode('$3.20')).toEqual([CLS, id('$'), id('3'), id('.'), id('20'), SEP]);
  });

  it('puts spaces around CJK characters so each is its own token', () => {
    expect(encode('你好')).toEqual([CLS, id('你'), id('好'), SEP]);
  });

  it('maps a word it cannot build from the vocabulary to [UNK], but still handles a word made of known pieces', () => {
    expect(encode('open zzz')).toEqual([CLS, id('open'), UNK, SEP]);
    expect(encode('unbelievable')).toEqual([CLS, id('un'), id('##believ'), id('##able'), SEP]);
  });

  it('maps a word longer than the limit to [UNK]', () => {
    expect(encode('a'.repeat(101))).toEqual([CLS, UNK, SEP]);
  });

  it('ignores control characters and treats tabs, newlines and odd spaces as separators', () => {
    expect(encode('open\u0000\u0007\thours\n\r\u00a0open')).toEqual([CLS, id('open'), id('hours'), id('open'), SEP]);
  });

  it('truncates to the token limit and still ends with [SEP]', () => {
    const ids = encode('open '.repeat(50), 10);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe(CLS);
    expect(ids[9]).toBe(SEP);
  });

  it('encodes the empty string as just [CLS] [SEP]', () => {
    expect(encode('')).toEqual([CLS, SEP]);
  });

  it('refuses a tokenizer file that is not WordPiece, or whose vocabulary lacks the special tokens', () => {
    expect(() => new WordPieceTokenizer({ model: { type: 'BPE', vocab: {} } })).toThrow(/WordPiece/);
    expect(() => new WordPieceTokenizer({ model: { type: 'WordPiece', vocab: { open: 0 }, unk_token: '[UNK]' } })).toThrow(/\[UNK\]/);
  });
});

const dir = process.env['EMBEDDING_MODEL_DIR'];
(dir ? describe : describe.skip)('WordPieceTokenizer against the real MiniLM tokenizer.json (reference: Hugging Face tokenizers)', () => {
  const real = () => new WordPieceTokenizer(JSON.parse(fs.readFileSync(path.join(dir!, 'tokenizer.json'), 'utf8')) as TokenizerFile, 256);
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tokenizer-parity.json'), 'utf8')) as Array<{ text: string; ids: number[] }>;

  it.each(cases.map((c) => [JSON.stringify(c.text).slice(0, 48), c] as const))('produces the reference ids for %s', (_label, c) => {
    expect(real().encode(c.text).ids).toEqual(c.ids);
  });
});
