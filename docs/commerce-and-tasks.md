# Commerce and Tasks pages

Products, Orders, Revenue (under Commerce) and Tasks are admin pages. This note records what their numbers mean and what the backend does not support yet.

## What Revenue means

The Revenue page is built from the commerce ledger (`commerce_ledger_entries`), which records money only after a payment is verified. It is not derived from order statuses.

| Figure | Definition |
| --- | --- |
| Gross sales | Sum of `GMV` entries (the verified amount customers paid) |
| Refunded | Sum of `data.refundAmountMajorUnits` on `REFUND_ADJUSTMENT` entries |
| Platform fee | Fees charged (`TAKE_RATE`) minus the fee returned on refunds (`data.takeRateClawbackMajorUnits`) |
| You keep | Gross sales - Refunded - Platform fee |

- A period is compared with the equal-length period before it, in the workspace timezone. No percentage is shown when the earlier period had nothing to compare with.
- Currencies are never added together; each currency has its own tab.
- Eval-harness orders are excluded, the same as the transaction list.
- Money is summed in whole minor units (`revenue-summary.util.ts`), so totals do not drift.
- Refunded money is read from the entry's own data, not its sign. A refund entry's own amount is the fee reversal, not the refund.
- Analytics shows "Order revenue", a different number: orders paid in the period that are not cancelled or refunded, at full order value. A partially refunded order counts in full there, and the ledger figures here net the refund off.

## Backend added for this

- `GET /commerce/ledger/summary?preset|from|to` (admin only): totals for the period and the previous period, a daily series, and sales by product, per currency. Read-only.
- `GET /commerce/ledger` gained optional `from`, `to` and `currency`, and each entry now carries its order's status and customer name.

No schema change and no migration.

## Gaps (not supported by the backend, so not in the UI)

- **Tasks cannot be created, edited or deleted from the UI.** Tasks are created only by the AI assistant and the payment and approval flows. There is no create, update or delete endpoint.
- **Tasks have no due date**, so there is no overdue view or due-date filter. The page shows how long a task has waited instead.
- **Tasks have no comments, reminders, attachments or history.**
- **Products cannot be deleted**, only deactivated (the API soft-deletes), and SKU and currency cannot change after creation.
- **Refunds cannot be started from the Orders page.** The order status machine allows PAID to REFUNDED, but a refund must also write ledger entries, so it is deliberately not offered there.
- **Orders and Products load in full and are filtered and paged in the browser.** Fine for a normal catalogue and order history; a tenant with many thousands of orders needs server-side paging on `GET /commerce/orders`.
- **Discounts, taxes and partial payments are not modelled** on orders, so none are shown.
- `GET /commerce/ledger` and the order and product endpoints are open to any signed-in role on the server; only the pages are admin-only.
