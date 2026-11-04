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
| Publish a video (creator-info check, queue, chunked upload, status polling, retries) | yes, behind flag `tiktok_publishing`; **contract checked against TikTok's published documentation** (`docs/TIKTOK_CONTRACT_VERIFICATION.md`) | unit + db (mocked) | **no**: needs `video.publish` on the app and TikTok's audit for public visibility (until then "Only me") | no |
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

## AI and platform capabilities (same four columns)
| Capability | Implemented | Tested | Provider-authorised | Real-integration verified |
|---|---|---|---|---|
| Voice-note transcription (all inbound channels) | yes, workspace opt-in + provider keys | unit + db (mocked provider) | **no**: no speech provider is configured or contracted | no |
| Image understanding | yes, workspace opt-in + vision-capable model only (the platform chat model is text-only and is refused) | unit + db (mocked provider) | **no**: no vision provider is configured or contracted | no |
| Daily AI spend cap, warning and cap-reached alerts, usage screens | yes | unit + db (real Postgres, concurrency, isolation) + e2e | n/a | no (not yet deployed anywhere) |
| Prompt, log and stored-diagnostic redaction | yes (model boundary, tool traces, execution errors, error logging) | unit + provider-boundary tests + structural guards | n/a | no |
| Per-tool authorisation (validated arguments, verified context, bounded and replay-safe calls) | yes | unit + db (two workspaces) | n/a | no |
| Credential encryption tooling | yes (encrypt, verify, roll back), production **disabled** | unit + db + 34-check rehearsal on a disposable database | n/a | no (staging run on production-shaped data still to do; production key not generated) |
| Off-host backup | tooling complete, **disabled** until a destination is approved | 25 local checks (a local directory stands in for the remote) | **no destination, region or key holders recorded** | no: nothing has been uploaded anywhere |
| Backup trial monitor | yes (extended); installed monitor on the VPS is the earlier version until updated after the gate | 44 hermetic checks on Linux | n/a | the trial has not yet produced a scheduled run (first: 2026-11-05 02:30 CET) |

## Rules for changing this file
A cell moves to "yes" in **Real-integration verified** only with a dated note saying who ran what against which real account. A mock never moves it.
