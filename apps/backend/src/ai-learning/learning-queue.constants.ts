/**
 * Every number that bounds how often, and for how long, an AI Learning evaluation can call the paid provider. They live in one
 * place because the safety argument spans three layers (queue, worker, ledger) and only holds while they agree:
 *
 *   paid provider calls for one execution  <=  LEARNING_MAX_RUNS_PER_EXECUTION  =  attempts + tolerated stalls  =  3 + 1
 *
 * BullMQ re-runs a job's processor for (a) each failed attempt, up to `attempts`, and (b) each stall recovery, up to
 * `maxStalledCount` (a stalled job is re-queued without consuming an attempt; one more stall fails it without running the
 * processor). Each run makes at most ONE provider attempt (`maxAttempts: 1`). The ledger enforces the same ceiling in the database,
 * so a re-enqueued job, a manual retry or a configuration drift cannot exceed it. Verified against bullmq 5.76.6, see the tests in
 * ai-learning.queue.integration.spec.ts, which assert the live Queue/Worker options, not these constants alone.
 */
export const LEARNING_JOB_ATTEMPTS = 3;
export const LEARNING_JOB_BACKOFF_MS = 5_000;
export const LEARNING_MAX_STALLED_COUNT = 1;
export const LEARNING_MAX_RUNS_PER_EXECUTION = LEARNING_JOB_ATTEMPTS + LEARNING_MAX_STALLED_COUNT;

/** BullMQ worker lock settings, stated explicitly (they equal the library defaults) so a library change cannot silently alter them. */
export const LEARNING_WORKER_LOCK_DURATION_MS = 30_000;
export const LEARNING_WORKER_STALLED_INTERVAL_MS = 30_000;
export const LEARNING_WORKER_CONCURRENCY = 1;

/** Hard total deadline for one learning provider request (all attempts, cancelled when it passes). */
export const LEARNING_PROVIDER_DEADLINE_MS = 30_000;
/** One provider attempt per run: retries belong to the queue, where each one is a separately accounted run. */
export const LEARNING_PROVIDER_MAX_ATTEMPTS = 1;
/**
 * Provisional reservation lease, on the database clock. Must exceed the provider deadline plus the persistence that follows it
 * (settlement transaction, evaluation write): 30 s deadline + roughly 15 s of lock wait and writes = 45 s, rounded up with margin.
 * Expiry never frees budget by itself; it only allows the next run to start (see AiLearningCostService).
 */
export const LEARNING_LEASE_MS = 60_000;
/** The judge answer is capped; this is also the output side of every reservation. */
export const LEARNING_MAX_OUTPUT_TOKENS = 500;
