import { createHmac } from 'crypto';
import { isSimulatedPhone } from '@whatsapp-platform/shared-utils';
import { mergeCounts, redactText, RedactionCounts, REDACTION_VERSION } from '../../common/privacy/pii-redaction.util';
import { DATASET_SCHEMA_VERSION, DatasetRecord, DatasetSplit, DatasetTurn, ExclusionReason, Stratum, TurnRole } from './dataset.types';

export interface RawMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: string | null;
  createdAt: Date;
  metadata: unknown;
  deletedForEveryone: boolean;
  sender: { isAiAgent: boolean; name: string | null } | null;
}
export interface RawEvaluation {
  status: string;
  overallScore: number | null;
  failureCategories: string[];
  needsHumanReview: boolean;
  customerCorrectionDetected: boolean;
  humanTakeoverFollowed: boolean;
}
export interface RawConversation {
  id: string;
  tenantId: string;
  updatedAt: Date;
  createdAt: Date;
  contact: { name: string | null; phone: string | null; isEvalContact: boolean } | null;
  messages: RawMessage[];
  evaluations: RawEvaluation[];
}

export const MAX_TURNS = 60;
/** Share of conversations reserved as held-out. Decided from the pseudonym, so a conversation never changes side between exports. */
export const HELDOUT_PERCENT = 30;

export function pseudonym(key: string, prefix: string, value: string, length: number): string {
  return `${prefix}_${createHmac('sha256', key).update(value).digest('hex').slice(0, length)}`;
}

export function splitFor(conversationRef: string): DatasetSplit {
  const bucket = parseInt(conversationRef.slice(-8), 16) % 100;
  return bucket < HELDOUT_PERCENT ? 'heldout' : 'dev';
}

const metaFlag = (metadata: unknown, key: string): boolean => !!metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>)[key] === true;

export function roleOf(m: RawMessage): TurnRole {
  if (m.direction === 'INBOUND') return 'customer';
  if (m.sender?.isAiAgent === true || metaFlag(m.metadata, 'aiGenerated')) return 'ai';
  if (m.sender) return 'human_agent';
  return 'system'; // a template, campaign, flow step or welcome message: automation, not a person and not the AI
}

export function strataOf(ai: number, human: number, firstAi: number, firstHuman: number): Stratum {
  if (ai === 0 && human === 0) return 'customer_only';
  if (human === 0) return 'ai_only';
  if (ai === 0) return 'human_only';
  if (firstAi < firstHuman) return 'ai_then_human';
  if (firstHuman < firstAi) return 'human_then_ai';
  return 'mixed';
}

export type BuildResult =
  | { ok: true; record: DatasetRecord; redactions: RedactionCounts }
  | { ok: false; reason: ExclusionReason };

/** Pure: turns one raw conversation into a dataset record, or says why it is excluded. Never mutates its input. */
export function buildRecord(raw: RawConversation, key: string, exportId: string): BuildResult {
  if (isSimulatedPhone(raw.contact?.phone) || raw.messages.some((m) => metaFlag(m.metadata, 'simulated'))) return { ok: false, reason: 'simulated' };
  if (raw.contact?.isEvalContact) return { ok: false, reason: 'eval_contact' };

  const usable = raw.messages
    .filter((m) => m.type === 'TEXT' && !m.deletedForEveryone && typeof m.content === 'string' && m.content.trim().length > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  const names = [raw.contact?.name, ...usable.map((m) => m.sender?.name)];
  const redactions: RedactionCounts = {};
  const turns: DatasetTurn[] = [];
  let last = '';
  const t0 = usable[0]?.createdAt.getTime() ?? 0;
  for (const m of usable) {
    const role = roleOf(m);
    const { text, counts } = redactText(m.content, { knownNames: names });
    mergeCounts(redactions, counts);
    const sig = `${role}|${text}|${Math.floor(m.createdAt.getTime() / 1000)}`;
    if (sig === last) continue; // the same message stored twice in the same second
    last = sig;
    turns.push({ i: 0, role, text, t: Math.max(0, Math.round((m.createdAt.getTime() - t0) / 1000)) });
  }

  if (!turns.some((t) => t.role === 'customer')) return { ok: false, reason: 'no_customer_message' };
  if (turns.length < 2) return { ok: false, reason: 'too_short' };

  const truncatedTurns = turns.length > MAX_TURNS;
  const kept = turns.slice(0, MAX_TURNS).map((t, i) => ({ ...t, i }));
  const aiIdx = kept.filter((t) => t.role === 'ai').map((t) => t.i);
  const humanIdx = kept.filter((t) => t.role === 'human_agent').map((t) => t.i);

  const evaluated = raw.evaluations.filter((e) => e.status === 'EVALUATED' || e.status === 'NEEDS_REVIEW');
  const scores = evaluated.map((e) => e.overallScore).filter((s): s is number => typeof s === 'number');

  const conversationRef = pseudonym(key, 'conv', `${raw.tenantId}:${raw.id}`, 24);
  return {
    ok: true,
    redactions,
    record: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      conversationRef,
      tenantRef: pseudonym(key, 'ten', raw.tenantId, 12),
      split: splitFor(conversationRef),
      stratum: strataOf(aiIdx.length, humanIdx.length, aiIdx[0] ?? Infinity, humanIdx[0] ?? Infinity),
      startedMonth: new Date(t0).toISOString().slice(0, 7),
      turns: kept,
      humanAnswerTurns: humanIdx,
      signals: {
        aiTurns: aiIdx.length,
        humanTurns: humanIdx.length,
        humanTakeover: aiIdx.length > 0 && humanIdx.some((h) => h > aiIdx[0]),
        evaluated: evaluated.length > 0,
        lowestScore: scores.length ? Math.min(...scores) : null,
        needsHumanReview: evaluated.some((e) => e.needsHumanReview),
        customerCorrection: evaluated.some((e) => e.customerCorrectionDetected),
        failureCategories: [...new Set(evaluated.flatMap((e) => e.failureCategories))].sort(),
      },
      provenance: { source: 'production', exportId, redactionVersion: REDACTION_VERSION, truncatedTurns },
    },
  };
}
