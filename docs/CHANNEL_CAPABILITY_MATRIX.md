# Channel capability matrix (2026-11-04)

Four separate questions, answered separately. A cell is only "yes" when that exact thing happened.

| Column | Meaning |
|---|---|
| **Implemented** | the code exists on `integration/staging-candidate-v2` |
| **Tested** | automated tests exist and were run: `unit` = pure logic; `db` = real PostgreSQL through the real routes with the provider **mocked** |
| **Provider-authorised** | the provider has granted our app/account the access this needs |
| **Real-integration verified** | it has worked against the real provider (not a mock) and been checked by a person |

Nothing in this branch has been deployed to staging or production (AP-3 hold until 2026-11-05 09:45Z), so "real-integration verified" can only be a pre-existing production fact or "no".

Legend: yes / no / n/a / unknown (not established by this programme) / pending (needs the post-gate step or a human).

## Telegram
| Capability | Implemented | Tested | Provider-authorised | Real-integration verified |
|---|---|---|---|---|
| Connect a bot (getMe, webhook + secret registration, token encrypted) | yes | unit + db (mocked) | n/a (a bot token is the authorisation) | pending (needs a real bot + public HTTPS: `docs/TELEGRAM_STAGING_WEBHOOK.md`) |
| Inbound private text | yes | db | n/a | pending |
| Inbound photo / voice / video / document (download with bot token, store) | yes | db | n/a | pending |
| Webhook secret verification, tenant from channel, duplicate delivery | yes | db | n/a | pending |
| Outbound text and media, 4096/1024 limits, 429 retry, blocked/401 handling | yes | db | n/a | pending |
| Disconnect (deleteWebhook, drop token) | yes | unit | n/a | pending |
| Group chats, edits, reactions, delivery/read receipts | no (Bot API provides no receipts; groups out of scope) | n/a | n/a | n/a |

## TikTok: posting (Login Kit + Content Posting API)
| Capability | Implemented | Tested | Provider-authorised | Real-integration verified |
|---|---|---|---|---|
| Connect account, token refresh with rotation, revoke on disconnect | yes (earlier work) | unit | account verification only | pending (a person must log in) |
| Publish a video (queue, chunked upload, status polling, retries) | yes, behind flag `tiktok_publishing` | unit + db (mocked) | **no**: needs `video.publish` on the app and TikTok's audit for public visibility (until then "Only me") | no |
| Duplicate-post protection, uncertain-outcome handling, audit trail | yes | db (race test mutation-checked) | n/a | no |
| UI: post panel and statuses | yes | typechecked only (no component test on this branch) | n/a | no |

## TikTok: direct messages (Business Messaging API)
| Capability | Implemented | Tested | Provider-authorised | Real-integration verified |
|---|---|---|---|---|
| Authorisation flow, encrypted tokens, one workspace per account | yes, behind flag `tiktok_messaging` + contract switch | db (mocked, **assumed wire contract**) | **unknown / probably no**: Business Messaging API access must be applied for and approved; "TikTok Accounts" permission enabled | no |
| Webhook: signature, normalisation, de-duplication, tenant isolation, echoes | yes | unit + db (mocked, assumed signature scheme and payload) | as above | no |
| Inbound text, image, shared post, sticker | yes | db (mocked) | as above | no |
| Outbound text and one image, 48 h window, 6000 chars, retries, lost-answer handling | yes | unit + db (mocked) | as above | no |
| Token renewal with rotation; reconnect-needed state | yes | db (mocked) | as above | no |
| Conversation history import (silent, idempotent) | yes | db (mocked) | as above | no |
| Webhook registration (operators only) | yes | db (mocked) | as above | no |
| UI: status, requirements list, connect, import | yes | typechecked only | n/a | no |
| Wire contract (paths, fields, signature) | partly: see provenance table in `docs/TIKTOK_MESSAGING.md` | n/a | n/a | **not confirmed**: the portal could not be read; an operator must confirm before enabling |

## Meta and WhatsApp (pre-existing, for reference)
| Channel | Implemented | Tested | Provider-authorised | Real-integration verified |
|---|---|---|---|---|
| WhatsApp Cloud API | yes | extensive unit + db | yes | yes (in production use before this programme) |
| Facebook Messenger send/receive | yes | unit + db | yes (`pages_messaging`) | unknown: not re-verified by this programme |
| Messenger history import and echo sync | yes | db (mocked Meta) | 3 webhook fields still to subscribe (request A, approved, not executed) | pending (post-gate against the known 2 conversations / 13 messages) |
| Instagram messaging | yes | unit | unknown | unknown |
| WhatsApp via QR (unofficial) | yes | unit | **no**: against WhatsApp's terms by design | pre-existing, unofficial |

## Not implemented (do not read these as "partly done")
Voice-note transcription, image understanding, AI spend-cap alerts and screens, prompt redaction: see the programme list in the completion report; none is in this table because none exists yet.

## Rules for changing this file
A cell moves to "yes" in **Real-integration verified** only with a dated note saying who ran what against which real account. A mock never moves it.
