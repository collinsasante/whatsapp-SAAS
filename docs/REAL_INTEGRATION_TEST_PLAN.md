# Real-provider integration test plan

Status: PLAN ONLY. Nothing in this document has been run. Every item is **BLOCKED** until the listed prerequisites exist, and a mocked test must never be recorded as passing any item here.
Written 2026-11-02. Use dedicated test workspaces, test accounts and test-mode credentials only. No production customer, number, page or Paystack live key.

## 0. Ground rules
- Environment: a separate test deployment (not the production or the staging stack that holds real customers' data) or a local stack with a public tunnel. Staging currently shares production's Meta app callback (see section 3), so do not repoint anything for these tests.
- Create one test workspace per provider, named `ZZ TEST <provider> <date>`; delete or suspend it afterwards.
- Evidence to keep for every step: the request or action, the timestamp (UTC), the log lines (sanitized: no tokens, no phone numbers beyond the test ones), the database rows, and a screenshot of what the user saw.
- A step passes only when the real provider produced the observable result. "The code path ran" is not a pass.

## 1. Paystack test-mode checkout and webhook
Prerequisites: a Paystack account in **test mode** with test secret key; a public HTTPS URL for `/api/v1/commerce/webhooks/paystack` (tunnel is fine); `PAYSTACK_SECRET_KEY` set to the test key on the backend and worker; a test workspace with Commerce enabled, one product, one customer contact.

| Step | Action | Expected | Evidence |
|---|---|---|---|
| 1.1 | Create an order and request payment | Order `PENDING_PAYMENT`, `paystackReference` set, checkout URL opens | order row, URL |
| 1.2 | Pay with Paystack's test card for success | Webhook `charge.success` arrives, order `PAID`, ledger has `GMV` and `TAKE_RATE` entries with the workspace rate | webhook event row `PROCESSED`, ledger rows |
| 1.3 | Replay the same webhook (Paystack dashboard "resend") | No new ledger rows, outcome processed or ignored | ledger count unchanged |
| 1.4 | Pay an order with an amount that differs (create a second order, pay a different amount via a manually initialised transaction on the same reference, or use Paystack's dashboard to resend an edited payload only if signature allows) | Refused: webhook answered 200 with outcome `FAILED` and a reason; order stays `PENDING_PAYMENT`; no ledger rows | event row `FAILED` |
| 1.5 | Pay with a card that fails | No `PAID` transition | order status |
| 1.6 | Reconciliation job | Runs against Paystack verify API and raises no exception for 1.2; raises `AMOUNT_MISMATCH` for a seeded mismatch | exceptions table |
| 1.7 | Credit pack purchase | Credits added exactly once, amount and currency checked | credit ledger |
Refund steps are added after `COMMERCE_REFUND_DESIGN.md` decisions D1 to D9.
Status: **BLOCKED** (no Paystack test account or public webhook URL available to me).

## 2. WhatsApp Cloud API inbound and outbound
Prerequisites: a Meta app and a **test** WhatsApp Business Account with the Meta-provided test number (or a spare real number that is not used by any customer); `WHATSAPP_APP_SECRET` equal to that app's secret; webhook URL and verify token registered for the test app; a second phone for the human end.

| Step | Action | Expected |
|---|---|---|
| 2.1 | GET verification from Meta when saving the webhook | 200 with the challenge |
| 2.2 | Send a text from the phone | Webhook accepted (signature valid), message in the inbox, contact and conversation created in the test workspace only |
| 2.3 | Send a forged request (unsigned, wrong signature) to the same URL with `curl` | 400, nothing stored |
| 2.4 | Agent replies inside 24 hours | Delivered, status moves SENT then DELIVERED then READ from Meta status webhooks |
| 2.5 | Send a template outside the 24-hour window | Delivered; a text outside the window is refused with a clear error |
| 2.6 | Send image, document, audio | Delivered and playable on the phone |
| 2.7 | Inbound media | Downloaded and visible in the inbox |
| 2.8 | Number belongs to a second workspace | Messages for that number never appear in the first workspace |
Status: **BLOCKED** (needs the test WABA and number).

## 3. Instagram inbound and outbound
What the earlier read-only diagnostics showed (2026-11-02, production, from `instagram-diagnostics*-output.txt`): the Meta app "Verzchat Production" has a webhook subscription for **object `page` only**, callback `https://verzchat.com/api/v1/webhook/messenger`. There is **no `instagram` object subscription**. One Instagram channel (`@glam.pack`) is connected with a token and matching account id, but **zero Instagram webhook events have ever been received** and 0 Instagram messages are stored. The staging environment has `INSTAGRAM_LOGIN_CONFIG_ID` empty. So Instagram inbound cannot work in production today.

Required Meta configuration (to confirm against the current Meta documentation while doing it, because Meta renames these screens and fields):
1. In the Meta app dashboard, Webhooks, add a subscription for the **Instagram** object (not Page) with the callback `/api/v1/webhook/messenger` and the same verify token (`MESSENGER_WEBHOOK_VERIFY_TOKEN`), and subscribe the `messages` field (plus `messaging_postbacks`, `message_reactions` if used).
2. The Instagram professional account must be linked to the Facebook Page, and messaging access allowed in the Instagram app settings ("Allow access to messages").
3. The app needs the Instagram messaging permission(s) the connect flow requests, approved through App Review for accounts that are not app testers. While in development mode only app admins, developers and testers receive events.
4. The connected account must be subscribed to the app (`subscribed_apps` for the Instagram account or its Page, depending on login type).
5. `FACEBOOK_APP_SECRET` must be the secret of the same app, because signatures are checked with it.

Verification steps (use a **test Meta app**, not "Verzchat Production", and a test Instagram professional account added as an app tester):

| Step | Action | Expected |
|---|---|---|
| 3.1 | Meta dashboard: "Test" a webhook field, or save the subscription | Verification GET reaches the backend; log shows `Messenger webhook verified` |
| 3.2 | Connect the test Instagram account in the test workspace | Channel `INSTAGRAM` active with token and page id |
| 3.3 | From a second Instagram account (tester) send a DM | Event reaches the webhook, signed correctly, stored as a message and conversation in the test workspace |
| 3.4 | Reply from the inbox | Delivered to the Instagram app; sending outside Meta's messaging window is refused with a clear error |
| 3.5 | Same Instagram id connected to two workspaces | Rejected or routed to exactly one (the diagnostics found 0 such cases today) |
| 3.6 | Unsigned request to the webhook | 400 |
Status: **BLOCKED** (needs a test Meta app and Instagram test accounts; the production app configuration is the owner's action and I did not change it).

## 4. Scheduled campaign delivery
Prerequisites: the section 2 WhatsApp test setup with an **approved** marketing template; 3 test recipients you control (one opted out, one blocked); worker and Redis running; `PUBLIC_BASE_URL` set.

| Step | Action | Expected |
|---|---|---|
| 4.1 | Create a campaign, schedule it 3 minutes ahead | Status `SCHEDULED`, a delayed job exists |
| 4.2 | Wait | At the time it moves to `RUNNING`, then messages are sent; recipients `SENT`, counters update; status `COMPLETED` |
| 4.3 | Delivery tracking | Status webhooks move recipients to DELIVERED/READ; click link recorded if a tracking URL was set |
| 4.4 | Opted-out and blocked contacts | `FAILED` with reason, never messaged |
| 4.5 | Delete a scheduled campaign before its time | Job removed, nothing sent |
| 4.6 | Pause during sending, then resume | Stops promptly; resume sends only the remaining recipients, nobody twice |
| 4.7 | Break the credentials (revoke the token) before sending | Campaign ends `FAILED` with recipients `FAILED` and a reason; no endless retries |
| 4.8 | Restart the worker mid-campaign | Remaining recipients are sent after restart; no duplicates |
Status: **BLOCKED** (needs a real WhatsApp number and approved template). Local evidence (disposable Postgres and Redis, no Meta call) covers only the failure and state-machine paths.

## 5. Hybrid RAG with real embeddings
Prerequisites: the pinned MiniLM model files and `onnxruntime-web` on the host (`staging-rollout-runbook.md`), the pgvector Postgres image, a test workspace with a knowledge base of known content.
Steps: build the index for one test workspace (dry run first); ask paraphrased questions whose keywords do not appear in the articles; confirm the answer cites the right article and the retrieval trace reports `mode: hybrid` including `vector`; confirm a second workspace never retrieves the first one's articles; stop the model files and confirm fallback to keyword search with a logged reason; record memory (`docker stats`) and latency; roll back by switching the flag off.
Status: **BLOCKED** (model files and pgvector host not available in this environment; the pgvector store itself passed 13/13 on a real pgvector Postgres, but with a synthetic concept embedder, not the real model).

## 6. WhatsApp-web (QR) session lifecycle
Prerequisites: a spare WhatsApp account on a phone you control (this is not Meta's official API; use a number that can be banned), the whatsapp-web service with `WHATSAPP_WEB_INTERNAL_API_KEY` on whatsapp-web, backend and worker.
Steps: start pairing and scan the QR; status moves to connected; send and receive text and media; restart the whatsapp-web container and confirm the session restores without a new QR; kill the network and confirm reconnect with backoff; log out from the phone and confirm the channel shows disconnected and sends fail clearly; call the whatsapp-web HTTP API without the key and confirm 401, and with the key unset confirm 503.
Status: **BLOCKED**. Only the service's authentication middleware is unit-tested.

## 7. Exit criteria
Production is not released on the strength of this document. The required sections for a first release are 1, 2 and 4 (payments, WhatsApp, campaigns); 3, 5 and 6 are required only for the features that will be advertised.
