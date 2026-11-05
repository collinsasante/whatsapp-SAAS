import { PrismaClient } from '@prisma/client';

/**
 * Durable send idempotency for campaigns.
 *
 * Meta's Cloud API has no idempotency key, so "send, then record" can never be made exactly-once by retrying alone: a retried job that
 * cannot tell whether its predecessor's call was accepted will either skip a recipient or send twice. Sending twice to a customer is the
 * worse failure, so the order is fixed and every step is a conditional UPDATE in PostgreSQL:
 *
 *   1. claim    PENDING and unclaimed  ->  claimed (claimed_at, claim_token)          exactly one worker wins; others skip
 *   2. send     the HTTP call to Meta (the only step that cannot be undone)
 *   3. record   claimed by me          ->  SENT + whatsapp_message_id                 written the moment Meta accepts, before anything else
 *   4. link     create the Message row and set message_id                             repairable: step 3 already holds the message id
 *
 * A recipient is never offered for sending again once claimed. If a worker dies between 1 and 3 nobody knows whether Meta accepted the
 * message, so after a lease the recipient is closed as FAILED with an explicit "delivery unknown" reason instead of being resent.
 * That is the exact boundary: duplicates cannot come from our side; at worst a message Meta did accept is reported as failed.
 */

/** A send is one HTTP call (15 s timeout) plus a few writes. A claim with no outcome after this long means the worker is gone. */
export const CLAIM_LEASE_MS = 2 * 60_000;

export const UNKNOWN_DELIVERY_REASON =
  'Delivery unknown: the worker stopped while sending this message. It was not retried automatically, to avoid sending a duplicate to the customer.';

type Db = Pick<PrismaClient, 'campaignRecipient' | 'campaign'>;

/** Atomically takes a recipient for sending. True only for the single caller that wins. */
export async function claimRecipient(db: Db, recipientId: string, campaignId: string, token: string, now: Date): Promise<boolean> {
  const { count } = await db.campaignRecipient.updateMany({
    where: { id: recipientId, campaignId, status: 'PENDING', claimedAt: null },
    data: { claimedAt: now, claimToken: token },
  });
  return count === 1;
}

/** Records that Meta accepted the message. Only the claim holder can do this, and only once. */
export async function recordAccepted(db: Db, recipientId: string, token: string, whatsappMessageId: string, now: Date): Promise<boolean> {
  const { count } = await db.campaignRecipient.updateMany({
    where: { id: recipientId, claimToken: token, status: 'PENDING' },
    data: { status: 'SENT', sentAt: now, whatsappMessageId },
  });
  return count === 1;
}

/** Closes a claimed recipient as failed. Only the claim holder can do this. */
export async function recordFailed(db: Db, recipientId: string, token: string, errorMessage: string, errorCode: number | null): Promise<boolean> {
  const { count } = await db.campaignRecipient.updateMany({
    where: { id: recipientId, claimToken: token, status: 'PENDING' },
    data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 500), errorCode },
  });
  return count === 1;
}

/**
 * Closes recipients of this batch whose claim outlived the lease without an outcome. Returns how many, so the caller can count them as failed.
 * A claim younger than the lease is left alone: its worker may still be mid-send.
 */
export async function closeStaleClaims(db: Db, campaignId: string, recipientIds: string[], now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const { count } = await db.campaignRecipient.updateMany({
    where: { id: { in: recipientIds }, campaignId, status: 'PENDING', claimedAt: { lt: cutoff } },
    data: { status: 'FAILED', errorMessage: UNKNOWN_DELIVERY_REASON, errorCode: null },
  });
  if (count > 0) await db.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: count } } });
  return count;
}
