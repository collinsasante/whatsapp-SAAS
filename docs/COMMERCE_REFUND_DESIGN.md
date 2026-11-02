# Commerce refunds: design and required owner decisions

Status: DESIGN ONLY. Nothing here is implemented, and no refund can currently be started from the product.
Written 2026-11-02 on branch `feature/ai-no-canned-replies`. Items marked **[OWNER]** are business or finance decisions that I have not made.
Statements about Paystack's behaviour are from its public documentation as I know it and were NOT re-verified against the live API or a test account in this session. Each must be confirmed in Paystack test mode before code is written.

## 1. What exists today (verified in code)

| Piece | State |
|---|---|
| Order states | `PENDING_PAYMENT, PAID, FULFILLING, COMPLETED, CANCELLED, REFUNDED`. `REFUNDED` is reachable from `PAID`, `FULFILLING`, `COMPLETED` (`orders/order-state.util.ts`). |
| Ledger | `CommerceLedgerEntry` types `GMV`, `TAKE_RATE` (negative), `REFUND_ADJUSTMENT`; unique `[orderId, type, gatewayEventId]` gives idempotency. |
| Refund maths | `computeRefundAdjustment` (`ledger/take-rate.util.ts`): clawback computed as the difference of the take-rate before and after, so any sequence of partial refunds totals exactly the same as one full refund. It uses the rate recorded on the order's own `TAKE_RATE` entry. |
| Recording a refund | `CommerceLedgerService.recordRefund(orderId, amount, gatewayEventId?)`: refuses non-paid orders, caps at the order total, moves the order to `REFUNDED` only when fully refunded. |
| Who calls it | **Nothing.** No controller, job, webhook handler or admin action. |
| Provider | `PaystackGateway` has initialize, verify, and subscription disable. No refund call, no refund webhook handling. |
| Money flow | Payments are initialised with no `subaccount` or `split`: customer money lands in the platform's single Paystack account. Merchant proceeds exist only as ledger arithmetic (GMV minus take rate). |
| AI | The Commerce AI is told it has no refund tool, and is tested for refusing refunds. |

Why no route can start a refund: the ledger half was built first and the provider half, the persisted refund record, and the permissions were never decided or built.

## 2. Why this is not implemented yet

1. It needs a new table and migration (a refund must be tracked as pending, successful or failed, and duplicates blocked). A schema change to a financial area, with production containing migrations this tree did not have, needs owner sign-off.
2. It needs decisions on authority and who bears cost (section 4).
3. It cannot be verified without a Paystack test-mode account and webhook URL. Mocks would only prove my reading of the documentation.

## 3. Proposed lifecycle (to implement after the decisions)

```
request ──▶ validate ──▶ INSERT refund row (REQUESTED, idempotency key)
                              │
                              ▼
                    call Paystack POST /refund  (never inside a DB transaction)
                              │
              ┌───────────────┼────────────────┐
         accepted         rejected         timeout/unknown
              │               │                │
          PENDING          FAILED         stays REQUESTED ──▶ reconciler asks Paystack
              │                                   (GET /refund?transaction=<reference>)
   webhook refund.processed / poll GET /refund/:id          and adopts or fails it
              │
         PROCESSED ──▶ one DB transaction: mark row PROCESSED + recordRefund(...) with gatewayEventId = provider refund id
```

### 3.1 Data model (new, forward-only migration; not written)
`commerce_refunds`: `id`, `tenant_id`, `order_id`, `amount_minor`, `currency`, `status` (`REQUESTED, PENDING, PROCESSING, PROCESSED, FAILED, NEEDS_ATTENTION`), `provider_refund_id` (unique when set), `idempotency_key`, `requested_by_id`, `reason`, `failure_reason`, `ledger_entry_id`, timestamps. Unique `(order_id, idempotency_key)`. Index `(tenant_id, status)`. Nothing existing is altered or dropped.

### 3.2 Rules
- **Duplicate requests:** the caller sends an idempotency key; the unique index returns the existing refund instead of creating a second. A second refund on the same order is only allowed if `sum(refunds not FAILED) + new amount <= amount actually paid`; the check and the insert happen under a row lock on the order.
- **Never mark success early:** the refund row becomes `PROCESSED` and the ledger is written only after Paystack reports `processed` (webhook or poll). A synchronous API "accepted" is `PENDING`, not success. The order moves to `REFUNDED` only through the existing `recordRefund` rule (cumulative total reaches the order total).
- **Take rate:** `recordRefund` already reverses the rate recorded on the order's own `TAKE_RATE` entry, so a later change of the platform percentage cannot alter an old order. Keep that.
- **Provider succeeded, local write failed:** the `REQUESTED/PENDING` row already exists before the provider call, so the reconciler finds the provider refund by transaction reference and completes the ledger write. `recordRefund` is idempotent on `gatewayEventId = provider refund id`, so replays are safe. A refund that stays unresolved beyond a threshold becomes `NEEDS_ATTENTION` and creates a `ReconciliationException` (existing table) for an admin.
- **Webhooks:** `refund.pending/processing/processed/failed`, verified with the existing Paystack signature check, matched by provider refund id then by reference, ignoring events for a refund this system did not create. Amount and currency must match the refund row, as for payments.
- **Failed refunds:** status `FAILED` with the provider's reason; the order and ledger are untouched; the request can be retried with a new key.
- **Audit:** every state change writes an audit record (existing `AuditService`) with actor, order, amount and provider id. Ledger entries remain append-only.
- **Customer notification:** a WhatsApp message on `PROCESSED` and on `FAILED` **[OWNER: wording, and whether it is sent automatically]**. Outside the 24-hour window this needs an approved template, which does not exist today.
- **Authorization:** server-side only, tenant-scoped, and the refund target is always looked up with the caller's `tenantId`.

## 4. Decisions required from the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Who may initiate a refund | (a) workspace owner/admin only; (b) workspace request, platform approval; (c) platform admin only | (b) while the platform pays out of its own Paystack balance, because the platform carries the cash risk. Not (a) alone. |
| D2 | Full or partial refunds | full only / full and partial | Full and partial: the ledger maths already supports partial exactly. |
| D3 | Who bears the take-rate clawback | the platform returns its fee on the refunded part (current ledger behaviour) / the platform keeps the fee | Keep current behaviour (merchant is not charged a fee on money that was returned), but confirm it is what your merchant terms say. |
| D4 | Who bears provider charges that Paystack does not return | platform / merchant | Needs the Paystack fee schedule for your account; I did not verify it. |
| D5 | Where the refund money comes from | the platform's Paystack balance now, recovered from the merchant's future proceeds / a held reserve | Recovered from future proceeds, with the shortfall visible in the ledger. A negative merchant balance policy is needed. |
| D6 | Time limit | e.g. only within N days of payment | Paystack itself limits refund age; confirm the limit and mirror it. |
| D7 | Customer notification | automatic / manual, wording, template | Automatic on success, with a short template you approve. |
| D8 | Orders already paid before this ships | allow / not allow | Allow, using the original payment reference. |
| D9 | Disputes and chargebacks | out of scope / handled | Out of scope for the first version; record manually. |

## 5. Implementation checklist once D1 to D9 are answered
1. Migration for `commerce_refunds` (reviewed against production's actual migration table).
2. `PaystackGateway.refund(...)` and `getRefund(...)` with timeouts, no retry on non-idempotent POST without the idempotency key.
3. `CommerceRefundService` (state machine above), `POST /commerce/orders/:id/refund`, admin approval route if D1 = (b).
4. Webhook branch for `refund.*` events in `commerce-webhook.controller.ts`; reconciler job in the worker.
5. Tests: duplicate request, over-refund, partial then full, provider timeout then reconcile, provider failure, webhook replay, wrong amount/currency, cross-tenant order id, unauthorised role, take-rate unchanged after a platform rate change.
6. Test-mode run on a dedicated Paystack test account (see `REAL_INTEGRATION_TEST_PLAN.md`) before any production use.

Until then: refunds are done outside the product, and `recordRefund` stays unreachable so that no refund can be recorded by accident.
