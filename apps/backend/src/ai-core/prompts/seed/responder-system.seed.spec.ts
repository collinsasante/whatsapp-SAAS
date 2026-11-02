import { createHash } from 'crypto';
import { RESPONDER_SYSTEM_BODY, RESPONDER_SYSTEM_BODY_V1_0_0, RESPONDER_SYSTEM_BODY_V1_2_0, RESPONDER_SYSTEM_BODY_V1_1_0_MD5, RESPONDER_SYSTEM_VERSION } from './responder-system.v1';
import { containsRetiredScript } from '../retired-wording';
import { buildIdentityAndSafetyBlock } from '../shared-identity-block';
import { SHARED_STYLE_RULES } from '../shared-style-rules';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

describe('responder.system seed fingerprints (the values every environment is compared against)', () => {
  it('current version and body (1.3.0)', () => {
    expect(RESPONDER_SYSTEM_VERSION).toBe('1.3.0');
    expect(md5(RESPONDER_SYSTEM_BODY)).toBe('8e9c4768f3e751b851cb36e78de4ebee');
  });

  it('the frozen 1.2.0 body (the checksum already present as a draft on staging)', () => {
    expect(md5(RESPONDER_SYSTEM_BODY_V1_2_0)).toBe('220760086c35a6b642bded7b23bb155b');
  });

  it('1.3.0 differs from 1.2.0 only in its opening line', () => {
    const [newFirst, ...newRest] = RESPONDER_SYSTEM_BODY.split('\n');
    const [oldFirst, ...oldRest] = RESPONDER_SYSTEM_BODY_V1_2_0.split('\n');
    expect(newRest).toEqual(oldRest);
    expect(newFirst).not.toEqual(oldFirst);
  });

  describe('1.3.0 identity', () => {
    const first = RESPONDER_SYSTEM_BODY.split('\n')[0];

    it('opens with the workspace identity, not an "AI assistant" framing, and names no software', () => {
      expect(first).toMatch(/^You speak for \{\{business_name\}\}, as a member of its team/);
      expect(RESPONDER_SYSTEM_BODY).not.toMatch(/AI assistant|chatbot|virtual assistant/i);
    });

    it('keeps the placeholders every stage fills, and the output contract', () => {
      for (const variable of ['business_name', 'personality', 'tenant_instructions', 'knowledge_base', 'business_info', 'conversation_state']) {
        expect(RESPONDER_SYSTEM_BODY).toContain(`{{${variable}}}`);
      }
      expect(RESPONDER_SYSTEM_BODY).toMatch(/Respond with ONLY valid JSON on a single line/);
    });

    it('states identity honesty itself, and the code-appended block repeats it independently', () => {
      expect(first).toMatch(/Never claim to be a human; if someone sincerely asks whether they are talking to a person, answer honestly/);
      const appended = buildIdentityAndSafetyBlock('Acme');
      expect(appended).toMatch(/Never claim to be human/);
      expect(appended).toMatch(/be honest/);
      expect(appended).toMatch(/NEVER reveal customer data/);
    });
  });

  it('the original v1.0.0 body', () => {
    expect(md5(RESPONDER_SYSTEM_BODY_V1_0_0)).toBe('ca62f1200862fe35c2baeea1a163c2b9');
  });

  it('the v1.1.0 fingerprint observed on staging', () => {
    expect(RESPONDER_SYSTEM_BODY_V1_1_0_MD5).toBe('f3cd38178edc4ff8ab2096179c5ca3af');
  });
});

describe('retired-wording detection', () => {
  it('flags the original v1.0.0 body, which scripts both the gap reply and the injection sentence', () => {
    expect(containsRetiredScript(RESPONDER_SYSTEM_BODY_V1_0_0)).toBe(true);
  });

  it('flags nothing in the current prompt or in the parts code appends to it', () => {
    expect(containsRetiredScript(RESPONDER_SYSTEM_BODY)).toBe(false);
    expect(containsRetiredScript(buildIdentityAndSafetyBlock('Acme'))).toBe(false);
    expect(containsRetiredScript(SHARED_STYLE_RULES)).toBe(false);
  });
});
