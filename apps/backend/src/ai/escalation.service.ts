import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EscalationReason =
  | 'human_request'
  | 'frustration'
  | 'loop_protection'
  | 'low_confidence'
  | 'verification_failed'
  | 'clarify_exhausted';

const HUMAN_REQUEST_PATTERNS = [
  /\b(talk|speak|chat)\s+(to|with)\s+(a\s+)?(real\s+)?(person|human|agent|someone|somebody|rep(resentative)?)\b/i,
  /\b(can|could|may)\s+i\s+(talk|speak)\s+to\s+(a\s+)?(human|agent|person|manager)\b/i,
  /\bconnect\s+me\s+(to|with)\s+(a\s+)?(human|agent|person)\b/i,
  /\bi\s+(want|need)\s+(a\s+)?(human|agent|person|real\s+person)\b/i,
  /\bstop\s+(the\s+)?(bot|robot|ai)\b/i,
  /\b(is\s+)?(this|that)\s+a\s+(bot|robot|machine)\?/i,
  /\bhuman\s+(please|now)\b/i,
  /\bcustomer\s+service\s+(rep|representative|agent)\b/i,
  /\bmanager\b.{0,15}\bplease\b/i,
];

const FRUSTRATION_WORDS = [
  'terrible', 'worst', 'useless', 'stupid', 'ridiculous', 'awful', 'horrible',
  'scam', 'waste of time', 'fed up', 'sick of', 'done with this', 'unacceptable',
  'angry', 'furious', 'annoyed', 'frustrated', 'pathetic', 'joke',
];

function isAllCapsAngry(message: string): boolean {
  const letters = message.replace(/[^A-Za-z]/g, '');
  if (letters.length < 8) return false; // too short to be a meaningful signal
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.7;
}

function hasFrustrationWord(message: string): boolean {
  const lower = message.toLowerCase();
  return FRUSTRATION_WORDS.some((w) => lower.includes(w));
}

@Injectable()
export class EscalationService {
  constructor(private prisma: PrismaService) {}

  /** "I want to talk to a human" always wins, regardless of confidence. */
  detectHumanIntent(message: string): boolean {
    return HUMAN_REQUEST_PATTERNS.some((p) => p.test(message));
  }

  /**
   * Precision-biased on purpose: repeated messages, ALL-CAPS anger, or two
   * frustration-worded messages in a row. False negatives (missing real
   * frustration) are far cheaper here than false positives (escalating a
   * calm customer), so this stays simple rather than trying to be clever.
   */
  detectFrustration(currentMessage: string, recentInboundMessages: string[]): boolean {
    if (isAllCapsAngry(currentMessage)) return true;

    const last = recentInboundMessages.slice(-2);
    if (last.length === 2) {
      const [prev, current] = last;
      const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
      if (normalize(prev) === normalize(current) && current.trim().length > 3) return true; // exact repeat
    }

    const recentWithCurrent = [...recentInboundMessages.slice(-1), currentMessage];
    const frustrationHits = recentWithCurrent.filter(hasFrustrationWord).length;
    return frustrationHits >= 2;
  }

  /**
   * True if the last `maxConsecutive` outbound messages in this conversation
   * were all from the AI agent with no human-agent turn in between -- Verz
   * must never carry a conversation alone indefinitely.
   */
  async isLoopProtectionTriggered(tenantId: string, conversationId: string, maxConsecutive: number): Promise<boolean> {
    const recentOutbound = await this.prisma.message.findMany({
      where: { tenantId, conversationId, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
      take: maxConsecutive,
      select: { sender: { select: { isAiAgent: true } } },
    });
    if (recentOutbound.length < maxConsecutive) return false;
    return recentOutbound.every((m) => m.sender?.isAiAgent === true);
  }

  /** Caps CLARIFY at one per conversation thread before forcing escalation. */
  async clarifyCount(tenantId: string, conversationId: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).aiInteractionLog.count({
      where: { tenantId, conversationId, action: 'CLARIFY' },
    });
  }

  /**
   * Posts an internal (agent-only) note summarizing why Verz escalated, so an
   * agent never has to reconstruct context by scrolling.
   */
  async postHandoffNote(opts: {
    tenantId: string;
    conversationId: string;
    verzAgentId: string;
    customerQuestion: string;
    reason: EscalationReason;
    draftReply: string | null;
    kbCoverageNote: string;
  }) {
    const reasonText: Record<EscalationReason, string> = {
      human_request: 'Customer explicitly asked for a human.',
      frustration: 'Customer appears frustrated (repeated message, ALL CAPS, or negative language).',
      loop_protection: 'Verz has replied several times in a row without a human turn.',
      low_confidence: 'Verz was not confident enough in its answer to send it automatically.',
      verification_failed: "Verz's draft contained a detail that could not be verified against the knowledge base.",
      clarify_exhausted: 'Verz already asked one clarifying question and the request is still ambiguous.',
    };

    const content = [
      `Verz escalated this conversation.`,
      `Reason: ${reasonText[opts.reason]}`,
      `Customer asked: "${opts.customerQuestion}"`,
      opts.kbCoverageNote,
      opts.draftReply ? `Verz's unsent draft: "${opts.draftReply}"` : 'Verz did not have a draft to offer.',
    ].join('\n');

    return this.prisma.conversationNote.create({
      data: { conversationId: opts.conversationId, authorId: opts.verzAgentId, content },
    });
  }
}
