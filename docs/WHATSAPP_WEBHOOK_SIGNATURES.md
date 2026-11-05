# WhatsApp webhook signatures with several Meta apps

Status: implemented on a local review branch, **not deployed**. Production behaviour after a deploy is "observe": nothing is rejected.

## Why one global secret cannot work

Meta signs every webhook (`x-hub-signature-256`, HMAC-SHA256 of the raw body) with the secret of the **Meta app that owns the webhook subscription**. A WhatsApp Business Account (WABA) can be subscribed to any number of apps, and this platform serves WABAs on several (on 2026-11-05: six apps across the live WABAs, none of them the app configured as `FACEBOOK_APP_ID`; one WABA has two apps subscribed). A single `WHATSAPP_APP_SECRET` therefore verifies the traffic of at most one app and rejects the rest. This already caused an hour of rejected production webhooks on 2026-10-22, which is why `infra/scripts/production-recreate.sh` refuses to run with that variable set.

## Design

| Piece | What it is |
|---|---|
| `whatsapp_meta_apps` | One row per Meta app: app id, label, status, the **encrypted** secret, and an 8-hex fingerprint of it (to compare with the dashboard, not to recover it). |
| `whatsapp_waba_apps` | Which app(s) deliver webhooks for which tenant's WABA. Unique on (tenant, WABA, app). A WABA may have several apps. A tenant can only be mapped to a WABA it owns (`whatsapp_numbers`). |
| `whatsapp_webhook_signature_stats` | Daily counters per (WABA, matched app, outcome). Identifiers and counts only: no payload, no signature, no secret. |
| `WhatsappWebhookSignatureService` | Verifies each request and records the outcome. Registry cached for 60 s; admin edits invalidate it at once. |
| `signature-policy.util.ts` | The pure policy (no I/O): modes, outcomes, decision. |

**Verification.** The webhook route fans out by `phone_number_id`, so the URL tenant id is not authoritative. The service reads the WABA ids from `entry[].id` (untrusted, used only to pick which mappings to compare), computes the HMAC with **every** registered secret (no early exit, so timing does not reveal which app matched), and accepts when a matching app is mapped to **every** WABA named in the body. A genuine signature from the wrong app therefore does not vouch for another app's WABA: a leaked secret of one app cannot be used to forge events into another app's tenants.

**Outcomes** (also the `outcome` column):

| Outcome | Meaning |
|---|---|
| `valid` | Matches a registered app that is mapped to every WABA in the body. |
| `valid_no_waba` | Matches a registered app; the body names no WABA. |
| `app_not_mapped` | Matches a registered app, but a WABA in the body is not mapped to it (missing mapping, or a different app). |
| `invalid` | Secrets are registered and none matches (forged, altered, or from an app not registered). |
| `missing_signature` | Secrets are registered and the header is absent or malformed. |
| `no_secrets` | Nothing is registered, so nothing can be concluded. |

**Legacy.** If `WHATSAPP_APP_SECRET` is set it counts as one extra app (`env:WHATSAPP_APP_SECRET`) that covers every WABA, so a single-app install (for example staging) behaves as before. **Leave it empty in production.**

## Modes (`WHATSAPP_WEBHOOK_SIGNATURE_MODE`)

| Mode | Behaviour |
|---|---|
| `observe` | Checks, counts and logs. **Never rejects.** Default when `NODE_ENV=production` and the variable is empty or unrecognised. |
| `enforce` | Rejects (HTTP 400) anything that is not `valid` / `valid_no_waba`. Default outside production (it then verifies only when a secret exists, as before). In production it must be set explicitly. |
| `off` | Checks nothing. |

Safety rules built in:
- A typo (`enforced`) never enables enforcement in production: it falls back to `observe` and logs an error.
- **Self-lockout guard.** In `enforce` with no registered secret the request is let through and logged as an error, instead of refusing every tenant.
- A registry that cannot be loaded keeps serving the previous copy.
- Statistics are written after the response; a failure to write them never affects a webhook.
- The mode is read at start-up. Changing it needs a backend restart (recreate of the backend container).

## Metrics and logs

- **Log line** (rate-limited to one per outcome/app/WABA per minute, with a repeat count): `whatsapp_webhook_signature outcome=<o> mode=<m> app=<id|-> wabas=…<last4> accepted=<bool> [repeats_since_last_log=n]`. Valid requests are counted, not logged. WABA ids are shortened to their last four digits.
- **Readiness summary** (platform admin, any role): `GET /platform-admin/whatsapp-webhook-security/summary?days=7&minValid=10` returns the mode, outcome totals, and per WABA: tenant, mapped apps, request count, verified count, problems, and a verdict `ready` / `not_ready` / `no_traffic` with the reason. `readyToEnforce` is true only when nothing blocks it. A WABA with no traffic cannot be judged and is reported, not guessed.
- **SQL equivalent:** `SELECT waba_id, app_id, outcome, sum(count) FROM whatsapp_webhook_signature_stats WHERE day >= current_date - 7 GROUP BY 1,2,3 ORDER BY 1,3;`

## Rollout

1. **Prerequisites (human).** `CREDENTIALS_ENCRYPTION_KEY` installed (below). The release (migration `20261111120000_whatsapp_webhook_signature_registry`, additive) deployed. Behaviour after the deploy is observe: identical to today's production (accepts everything), plus counters. No secret is needed for this step. `WHATSAPP_APP_SECRET` stays empty.
2. **Register the apps.** For each Meta app, run the CLI below; the secret is typed at a hidden prompt. Then map WABAs (`--map`, or `POST …/discover` which asks Meta which apps are subscribed to each WABA and, with `apply:true`, maps them to apps that are already registered; it never registers an app).
3. **Observe.** Leave `observe` on for at least a week that includes every live WABA's normal traffic. Review the summary daily. Expected: every live WABA `ready`, zero `invalid`, zero `app_not_mapped`. Investigate any `invalid` (an unregistered app, or a forged request) and any `app_not_mapped` (a missing mapping, or a second app).
4. **Enforce (separate approval).** Set `WHATSAPP_WEBHOOK_SIGNATURE_MODE=enforce`, recreate the backend, watch the log and the summary, and have the rollback ready: set it back to `observe` (or empty) and recreate.
5. **Afterwards.** Adding a WABA or an app is a registry change, not a deploy. Rotating an app secret: register the new secret with the same CLI (replaces the old one).

## Supplying an app secret without exposing it

Never type a secret into chat, a ticket or a command line (arguments show in `ps` and shell history). Use the CLI, which reads it from a hidden prompt (or stdin when piped) and stores it encrypted:

```
docker exec -it <backend-container> node dist/whatsapp/webhook-signature/register-meta-app.cli.js \
  --app-id <numeric Meta app id> --label "<name>" --map <tenantId>:<wabaId> [--map <tenantId>:<wabaId> ...]
```

It refuses to run without `CREDENTIALS_ENCRYPTION_KEY`, refuses a mapping to a WABA the tenant does not own, and prints only the app id, label and an 8-hex fingerprint. The admin API (`PUT /platform-admin/whatsapp-webhook-security/apps/:appId`) offers the same over HTTPS for SUPER_ADMIN; it also refuses to store a secret without the key, never returns the secret, and writes an audit row that omits it. The app secret itself comes from the Meta app dashboard (App settings, Basic, App secret), copied by the person who owns that app.

## Generating and installing `CREDENTIALS_ENCRYPTION_KEY` (done by the operator, never by an assistant)

The key is 32 random bytes, base64-encoded. It encrypts connection credentials and, with this change, Meta app secrets. **If it is lost, everything encrypted with it is unrecoverable; if it changes, values encrypted with the old one stop decrypting.** Values that are not `enc:v1:`-prefixed (existing plaintext) keep working, so adding a key does not break existing credentials; they are encrypted only when rewritten (see `scripts/encrypt-existing-credentials` and `credential-reencryption.cli`).

On the server, as root, without ever echoing the key:

```
umask 077
openssl rand -base64 32 | tr -d '\n' > /root/credentials-encryption-key.new       # file is mode 600
test "$(base64 -d < /root/credentials-encryption-key.new | wc -c)" -eq 32 && echo "32 bytes: OK"
sha256sum /root/credentials-encryption-key.new | cut -c1-8                        # short fingerprint to note down, not the key
```

1. **Store a copy in your password manager first** (open the file in an editor, copy, paste there). Do not paste it anywhere else.
2. Install it with a builtin so it never appears in a process list: `printf 'CREDENTIALS_ENCRYPTION_KEY=%s\n' "$(cat /root/credentials-encryption-key.new)" >> /root/whatsapp-platform/infra/.env` (the file is already `600`).
3. Shred the temporary file only after step 1 is confirmed: `shred -u /root/credentials-encryption-key.new`.
4. The key reaches the backend, worker and whatsapp-web containers through compose; they pick it up when recreated, in a planned window. The same value must be on all three.
5. Verify without printing: `docker exec <backend> sh -c '[ -n "$CREDENTIALS_ENCRYPTION_KEY" ] && echo set'`, then register a test secret with the CLI and confirm the stored value starts with `enc:v1:`.

## Production mapping found on 2026-11-05 (Meta `subscribed_apps`, read-only)

App ids are not secrets. Tenant names are workspace labels. WABA ids are shortened.

| Tenant | WABA | Subscribed app(s) | Webhooks (30 d) |
|---|---|---|---|
| Packaging Glamour | …2441 | Business Agent (1143680903703001) **and** GlamPack (1367991062132397) | 67,307 |
| De - Movezz Logistics | …5646 | Movezz_Verz (1630706404694719) | 22,424 |
| PAKKmax | …5339 | PAKKmax-Verz (2428889007537244) | 21,805 |
| Ren9's Workspace | …3219 | Ren9 (857070483783249) | 1,398 |
| VERZCHAT's Workspace | …9898 | Verzchat (1281307854067000) | 0 |
| Ren9's Workspace | …5580 | unresolved (token rejected) | 1,208 (last 21 Oct) |
| Benard's Workspace | …9530, …9862 | unresolved (token rejected) | 0 |

## Known limits

- The webhook does not say which app signed it, so the share of traffic per app is learned only from the counters once apps are registered.
- A WABA with two subscribed apps may deliver the same event twice (once per app); duplicates are already absorbed by the provider-id uniqueness on messages.
- The cache is per process: after an admin edit the same process applies it at once, other replicas within 60 s.
- Decryption failures (wrong key) make that app's secret unusable and are logged as errors; the app then shows up as `invalid` traffic in observe mode.
