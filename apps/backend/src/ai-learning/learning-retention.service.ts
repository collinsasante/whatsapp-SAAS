import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Working defaults pending privacy approval: free text is kept 90 days, anonymised metrics 13 months. */
export const DEFAULT_FREE_TEXT_DAYS = 90;
export const DEFAULT_METRICS_MONTHS = 13;
const BATCH = 1_000;
/** A runaway sweep is stopped after this many batches per rule (the next run continues). */
const MAX_BATCHES_PER_RULE = 500;

export interface RetentionSettings {
  enabled: boolean;
  freeTextDays: number;
  metricsMonths: number;
}

/** Upper bounds: a period above these is a typo, not a policy, and the proposed default applies instead. */
export const MAX_FREE_TEXT_DAYS = 3_650;
export const MAX_METRICS_MONTHS = 120;

export function loadRetentionSettings(env: NodeJS.ProcessEnv = process.env): RetentionSettings {
  const period = (v: string | undefined, fallback: number, max: number): number => {
    const trimmed = (v ?? '').trim();
    if (!/^\d+$/.test(trimmed)) return fallback;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n > 0 && n <= max ? n : fallback;
  };
  return {
    // Off unless explicitly, exactly 'true': retention deletes customer-derived data, so it needs a deliberate decision (privacy approval).
    enabled: env['AI_LEARNING_RETENTION_ENABLED'] === 'true',
    freeTextDays: period(env['AI_LEARNING_RETENTION_FREE_TEXT_DAYS'], DEFAULT_FREE_TEXT_DAYS, MAX_FREE_TEXT_DAYS),
    metricsMonths: period(env['AI_LEARNING_RETENTION_METRICS_MONTHS'], DEFAULT_METRICS_MONTHS, MAX_METRICS_MONTHS),
  };
}

/**
 * EXACTLY what the sweep may change. Anything not listed here is never touched by retention. Reviewed content that was deliberately
 * approved as guidance (AiTrainingExample with status APPROVED), the learning cost ledger, AI credit records, Digital Self profiles and
 * their numeric learning events, audit logs, and the usage metrics on AiExecution are all out of scope.
 */
export const RETENTION_MANIFEST = [
  { id: 'logs.free_text', age: 'free text', table: 'ai_interaction_logs', action: 'blank', columns: ['customer_message', 'ai_response'], alsoNull: ['final_sent_message', 'feedback_note'], keeps: 'status, confidence, response time, rating, label, editedByAgent, agent and conversation ids' },
  { id: 'evaluations.free_text', age: 'free text', table: 'ai_interaction_evaluations', action: 'null', columns: ['evaluator_reasoning', 'evaluation_error'], keeps: 'scores, dimensions, categories, severity, status', unless: 'the evaluation has an APPROVED training example' },
  { id: 'feedback.free_text', age: 'free text', table: 'ai_evaluation_feedback', action: 'null', columns: ['notes', 'expected_action', 'expected_response'], keeps: 'rating, reason, classifications', unless: 'the evaluation has an APPROVED training example' },
  { id: 'corrections.free_text', age: 'free text', table: 'ai_customer_corrections', action: 'null', columns: ['reviewer_notes', 'expected_interpretation'], keeps: 'category and ids', unless: 'the evaluation has an APPROVED training example' },
  { id: 'examples.unapproved', age: 'free text', table: 'ai_training_examples', action: 'delete rows', columns: ['(whole row)'], keeps: '', unless: 'status is APPROVED' },
  { id: 'tasks.review_text', age: 'free text', table: 'internal_tasks', action: 'null', columns: ['description'], keeps: 'title, status, priority, ids', unless: "department is not 'ai_review'" },
  { id: 'executions.free_text', age: 'free text', table: 'ai_executions', action: 'null', columns: ['tool_trace', 'error_message'], keeps: 'tokens, cost, latency, status, model, ids' },
  { id: 'logs.metrics', age: 'metrics', table: 'ai_interaction_logs', action: 'delete rows', columns: ['(whole row, already blanked)'], keeps: '' },
  { id: 'evaluations.metrics', age: 'metrics', table: 'ai_interaction_evaluations', action: 'delete rows', columns: ['(whole row; feedback and corrections cascade)'], keeps: '', unless: 'the evaluation has ANY training example' },
] as const;

export type RetentionResult =
  | { enabled: false }
  | { enabled: true; freeTextCutoff: string; metricsCutoff: string; counts: Record<(typeof RETENTION_MANIFEST)[number]['id'], number> };

/**
 * Time-based retention for AI Learning data. DISABLED unless AI_LEARNING_RETENTION_ENABLED=true (privacy approval pending): when
 * disabled, run() reads and writes nothing. Each rule works in bounded batches and only touches rows that still hold the data, so a run
 * can be repeated or interrupted safely. Cutoffs use the database clock.
 */
@Injectable()
export class AiLearningRetentionService {
  private readonly logger = new Logger(AiLearningRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  settings(): RetentionSettings {
    return loadRetentionSettings();
  }

  async run(): Promise<RetentionResult> {
    const settings = this.settings();
    if (!settings.enabled) return { enabled: false };

    const [{ free_text_cutoff, metrics_cutoff }] = await this.prisma.$queryRaw<Array<{ free_text_cutoff: Date; metrics_cutoff: Date }>>(Prisma.sql`
      SELECT ((clock_timestamp() AT TIME ZONE 'UTC') - make_interval(days => ${settings.freeTextDays}::int)) AS free_text_cutoff,
             ((clock_timestamp() AT TIME ZONE 'UTC') - make_interval(months => ${settings.metricsMonths}::int)) AS metrics_cutoff`);
    const ft = free_text_cutoff;
    const mt = metrics_cutoff;

    const approved = Prisma.sql`EXISTS (SELECT 1 FROM ai_training_examples te WHERE te.source_evaluation_id = e.id AND te.status = 'APPROVED'::"TrainingExampleStatus")`;
    const counts = {
      'logs.free_text': await this.batched(Prisma.sql`
        UPDATE ai_interaction_logs SET customer_message = '', ai_response = '', final_sent_message = NULL, feedback_note = NULL
        WHERE id IN (SELECT id FROM ai_interaction_logs WHERE created_at < ${ft}
          AND (customer_message <> '' OR ai_response <> '' OR final_sent_message IS NOT NULL OR feedback_note IS NOT NULL) LIMIT ${BATCH})`),
      'evaluations.free_text': await this.batched(Prisma.sql`
        UPDATE ai_interaction_evaluations e SET evaluator_reasoning = NULL, evaluation_error = NULL
        WHERE e.id IN (SELECT e2.id FROM ai_interaction_evaluations e2 WHERE e2.created_at < ${ft}
          AND (e2.evaluator_reasoning IS NOT NULL OR e2.evaluation_error IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM ai_training_examples te WHERE te.source_evaluation_id = e2.id AND te.status = 'APPROVED'::"TrainingExampleStatus") LIMIT ${BATCH})`),
      'feedback.free_text': await this.batched(Prisma.sql`
        UPDATE ai_evaluation_feedback f SET notes = NULL, expected_action = NULL, expected_response = NULL
        WHERE f.id IN (SELECT f2.id FROM ai_evaluation_feedback f2 JOIN ai_interaction_evaluations e ON e.id = f2.evaluation_id
          WHERE f2.created_at < ${ft} AND (f2.notes IS NOT NULL OR f2.expected_action IS NOT NULL OR f2.expected_response IS NOT NULL)
          AND NOT ${approved} LIMIT ${BATCH})`),
      'corrections.free_text': await this.batched(Prisma.sql`
        UPDATE ai_customer_corrections c SET reviewer_notes = NULL, expected_interpretation = NULL
        WHERE c.id IN (SELECT c2.id FROM ai_customer_corrections c2 JOIN ai_interaction_evaluations e ON e.id = c2.evaluation_id
          WHERE c2.created_at < ${ft} AND (c2.reviewer_notes IS NOT NULL OR c2.expected_interpretation IS NOT NULL)
          AND NOT ${approved} LIMIT ${BATCH})`),
      'examples.unapproved': await this.batched(Prisma.sql`
        DELETE FROM ai_training_examples WHERE id IN (SELECT id FROM ai_training_examples WHERE created_at < ${ft} AND status <> 'APPROVED'::"TrainingExampleStatus" LIMIT ${BATCH})`),
      'tasks.review_text': await this.batched(Prisma.sql`
        UPDATE internal_tasks SET description = NULL
        WHERE id IN (SELECT id FROM internal_tasks WHERE department = 'ai_review' AND created_at < ${ft} AND description IS NOT NULL LIMIT ${BATCH})`),
      'executions.free_text': await this.batched(Prisma.sql`
        UPDATE ai_executions SET tool_trace = NULL, error_message = NULL
        WHERE id IN (SELECT id FROM ai_executions WHERE created_at < ${ft} AND (tool_trace IS NOT NULL OR error_message IS NOT NULL) LIMIT ${BATCH})`),
      'logs.metrics': await this.batched(Prisma.sql`
        DELETE FROM ai_interaction_logs WHERE id IN (SELECT id FROM ai_interaction_logs WHERE created_at < ${mt} LIMIT ${BATCH})`),
      'evaluations.metrics': await this.batched(Prisma.sql`
        DELETE FROM ai_interaction_evaluations WHERE id IN (SELECT e.id FROM ai_interaction_evaluations e WHERE e.created_at < ${mt}
          AND NOT EXISTS (SELECT 1 FROM ai_training_examples te WHERE te.source_evaluation_id = e.id) LIMIT ${BATCH})`),
    };
    this.logger.log(JSON.stringify({ event: 'ai_learning.retention_run', ...counts }));
    return { enabled: true, freeTextCutoff: ft.toISOString(), metricsCutoff: mt.toISOString(), counts };
  }

  private async batched(statement: Prisma.Sql): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RULE; i++) {
      const affected = await this.prisma.$executeRaw(statement);
      total += affected;
      if (affected < BATCH) break;
    }
    return total;
  }
}
