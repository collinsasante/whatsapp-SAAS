# Post-AP-3 staging runbook (executable sequence)

Written 2026-11-04 while the AP-3 formal check is pending. **Nothing here has been run.** Every step names its pass condition and what to do on failure. Production containers, the nftables gate, the old iptables layer, UFW, the admin exception, DNS and Cloudflare are never touched by this runbook. Use ONE persistent SSH master connection (UFW rate-limits port 22).

```bash
rm -f ~/.ssh/cm-stg-ap2; ssh -M -S ~/.ssh/cm-stg-ap2 -o ControlPersist=4h -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 -fN root@<vps>
vps(){ ssh -S ~/.ssh/cm-stg-ap2 root@<vps> "$@"; }
```

## 0. Before anything: the gate
**0.1 Baseline still intact (read-only).**
```bash
vps 'B=/root/staging-8443-accept-ap3-recheck-formal-20261104T103405Z/RECHECK/baseline.containers; docker ps -q | wc -l; diff <(for c in $(docker ps -q); do docker inspect -f "{{.Name}} {{.State.StartedAt}}" $c; done | sort) <(awk "{print \$1,\$2}" $B | sort) && echo CONTAINERS-UNCHANGED'
```
Pass: 18 containers and `CONTAINERS-UNCHANGED` (name and start time equal the baseline file). Any difference before the formal run means something restarted: stop, diagnose, do not deploy.

**0.2 Formal result.** After 2026-11-05 09:45Z:
```bash
F=/root/staging-8443-accept-ap3-recheck-formal-20261104T103405Z
vps "cat $F/FORMAL-STATUS.txt; grep -E '^(PASS|FAIL|REVIEW|RECHECK)' $F/recheck-formal.txt; cd $F && sha256sum -c SHA256SUMS | grep -vc ': OK'"
vps 'cd /root/staging-8443-accept-ap3-window-20261104T090717Z && sha256sum -c SHA256SUMS | grep -vc ": OK"'
```
Pass: `finished … rc=0` or rc=1 only because of the explained REVIEW items; `FAIL` count 0; "at least 24 h since the reboot" PASS; "02:00 backup after the reboot" PASS; the only REVIEW allowed is the IPv6-via-Cloudflare one (evidence `cf-v6-checks.txt`); both manifests print `0` not-OK. On any other outcome: **do not deploy**; preserve the output; diagnose the check versus the system (never edit a check silently).

**0.3 Server preconditions** (the release script has no free-space check):
```bash
vps 'df -h / /var/lib/docker | cat; free -m | sed -n 1,2p; uptime; ls /root/staging-release-backups | tail -3'
```
Pass: at least 15 GB free; no production alarm. The image build uses CPU and about 1.2 GB; run it off-peak (production traffic is quietest 01:00-05:00 UTC) and watch production latency.

## 1. Deploy `integration/staging-candidate-v2` to staging only
Commit to deploy: the HEAD of `integration/staging-candidate-v2` at deploy time (record it: `git rev-parse HEAD`), clean working tree, `chore/frontend-quality` NOT merged.
```bash
# local: confirm what is being released
git -C /Users/breezyyy/verz-worktrees/staging-candidate-v2 status --short | wc -l   # 0
git -C /Users/breezyyy/verz-worktrees/staging-candidate-v2 log --oneline -8
# push the branch to a remote the server can fetch, or copy a git bundle (do not force-push; do not publish unrelated work)
# server: a CLEAN checkout of exactly that commit
vps 'cd /root/staging-release-checkout && git status --short | wc -l && git rev-parse HEAD'
```
Follow `docs/staging-release.md` section 4 exactly: `CONFIRM_STAGING_RELEASE=<40-char sha> bash infra/scripts/staging-release-deploy.sh deploy <40-char sha>`. Evidence: `/root/staging-release-backups/rollback-<ts>/` (dump, checksum, `release-status.txt`).
Required settings the script checks include `CREDENTIALS_ENCRYPTION_KEY`; for TikTok the **staging env file must contain `TIKTOK_CLIENT_ID` and `TIKTOK_CLIENT_SECRET`** (the backend already has them; the compose change now also passes them to the worker). Optional but recommended: `OAUTH_STATE_SECRET` (falls back to `JWT_SECRET`).
The script recreates only backend, worker, realtime, whatsapp-web and frontend with `--no-deps`; PostgreSQL, Redis, MinIO and nginx keep their container ids.

**1.1 Verify.**
```bash
vps 'docker ps -q | wc -l'                                           # 18
vps 'for c in wa_staging_postgres wa_staging_redis wa_staging_minio wa_staging_nginx; do docker inspect -f "{{.Name}} {{.State.StartedAt}}" $c; done'   # unchanged
vps 'for c in $(docker ps --format "{{.Names}}" | grep -v staging); do docker inspect -f "{{.Name}} {{.State.StartedAt}}" $c; done'                # 9 production: unchanged
vps 'docker exec wa_staging_postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -Atc \"select migration_name from _prisma_migrations where migration_name in (\$\$20261104120000_channel_history_sync\$\$,\$\$20261105120000_ai_conversation_leases\$\$,\$\$20261106120000_ai_daily_credit_cap\$\$,\$\$20261107120000_tiktok_publications\$\$,\$\$20261108120000_ai_cap_alerts\$\$,\$\$20261109120000_message_enrichments\$\$) and finished_at is not null\""'   # six lines
curl -sk -o /dev/null -w '%{http_code}\n' https://staging.verzchat.com:8443/health
vps 'docker logs --since 10m wa_staging_backend 2>&1 | grep -ciE "error|exception" ; docker logs --since 10m wa_staging_worker 2>&1 | grep -E "TikTokTokenRefresh|Worker started" | head'
```
Pass: 18 containers; the four infrastructure containers and all nine production containers keep their start times; all six migrations finished; HTTPS 200; the worker logs `[TikTokTokenRefresh] Worker started`. Failure: use the documented code-only rollback (`rollback <tag>`); the migrations are additive and harmless to older code.

## 2. Messenger history import (real Meta, real staging database)
Known source figure from Meta before the work: 2 conversations, 13 messages for the staging test Page, versus 1 conversation and 4 messages already in the database (allow for changes in the live source; recount from Meta first).
2.1 **Source count from Meta (read-only, counts only)** with the in-container Prisma script pattern used on 2026-11-04 (decrypt the Page token inside the container; print counts and Meta error codes only).
2.2 **Start the import.** Either an admin opens Channels on staging (the status line starts it once for a Page never imported) or `POST /api/v1/channels/<channelId>/history-sync` with an admin token. Watch `GET …/history-sync` until `COMPLETED` (or read the `channel_history_syncs` row).
2.3 **Verify in the database (counts, no content):** conversations and messages for the channel equal the Meta counts (imported + already present); every row has `tenant_id` of the staging tenant and `channel_id` of the Page; `whatsapp_message_id` unique; `metadata->>'imported'` = true on imported rows; timestamps within Meta's range; `unread_count` unchanged for conversations that existed before; no new `conversation_events`/SLA fields set (`requested_at`, `sla_deadline` unchanged); no row in the WhatsApp channel changed (compare counts and max `updated_at` before/after).
2.4 **Inbox API** as an admin: `GET /api/v1/conversations?page=1&limit=25` contains the imported conversations (status OPEN, channel = the Page); open two and `GET …/messages`; check pagination (`page=2`) and older-message loading.
2.5 **Frontend** (human or browser): default inbox lists them with preview, time and participant name; the Channels card shows "Earlier conversations imported: N conversations, M new messages" and "Check for more".
2.6 **Repeat / incremental / resume:** run again (counts unchanged, `messages_skipped` > 0); send a new message to the Page from a second account and run again (only the new message is imported); to test resume, start a run and restart the backend container during it (staging only, after the first full pass) and confirm the stale-heartbeat takeover completes without duplicates.
2.7 **Webhook overlap:** the new message arrives by webhook first; run the import; exactly one row for that `mid`.
2.8 **Isolation:** a second tenant (or a synthetic one) sees none of the rows; `POST history-sync` for the channel id as another tenant returns 404.
2.9 **Logs:** `docker logs wa_staging_backend | grep sync_` shows `sync_started`/`sync_finished` with correlation id and counts; grep for message text, a token fragment and a full PSID: none.
Pass: all of the above. Record counts in the evidence file. **The Page webhook subscription is NOT changed** (approval request A): until it is, replies from the Page inbox and read/delivery ticks will not arrive; state that in the result.

## 3. TikTok (human login required)
3.1 Human: staging, Channels, TikTok, "Continue with TikTok", log in and authorise.
3.2 Expected: redirect to `/channels?success=tiktok`, toast "TikTok connected!". On failure the toast and backend log now show TikTok's error code and `log_id`; capture them (no codes or tokens).
3.3 Verify (counts and prefixes only): backend log `TikTok account connected for tenant …`; `channels` row of type TIKTOK with `credentials->>'accessToken'` starting `enc:v1:` and the same for `refreshToken`; `tokenExpiresAt` about 2 hours ahead; `externalId` = open id.
3.4 Refresh: `[TikTokTokenRefresh] pass:` every 10 minutes; once under 30 minutes remain, `TikTok token refreshed` and a new `tokenExpiresAt`. To test sooner without waiting, an operator may lower the stored `tokenExpiresAt` on the staging row (staging only).
3.5 Reauth path: revoke the app in the TikTok account settings, wait for the next pass: `metadata.tiktokAuth.status = REAUTH_REQUIRED`, dashboard "Reconnect needed". Then reconnect: same channel row re-activated, state cleared.
3.6 Disconnect: `TikTok authorization revoked`, `credentials` holds no tokens.
Pass: 3.2-3.6. Not tested by this: publishing (not implemented), messaging (no TikTok API).

## 4. AI on real providers and real BullMQ + PostgreSQL
4.1 Budget first: use a staging tenant with a small credit balance; record balance before/after; DeepSeek pricing is an unverified note in the code (about $0.14/$0.28 per million tokens), so measure real spend from the provider dashboard.
4.2 v2 validation: at least 10 conversations on the `verz_ai_v2` flag including tool use (`create_internal_task`, `remember_conversation_facts`), a malformed/empty question, a long message, an injection attempt, a human-handoff request. Record: reply delivered, execution status, parse failures (the earlier run had 2 of 4 rejected), credits reserved/settled/released.
4.3 Failure injection on staging: provider timeout (set an unreachable base URL for one call), 4xx and 5xx; verify the reservation is released on a definitive rejection and kept on an uncertain outcome, and no duplicate reply is sent.
4.4 Cross-replica lease: start a second backend container from the same image on the staging network for the test only, send two messages to one conversation at the same moment, confirm one provider call at a time (`ai_conversation_leases` row appears and disappears; one reply per message; credits charged once each). Remove the extra container afterwards.
4.5 BullMQ: run the AI learning/evaluation queue paths with real Redis/PostgreSQL (retries, duplicates, concurrency) and record job outcomes; run the real-Postgres suites against the staging image's schema copy, not the live staging database.

## 5. Cross-channel regression
WhatsApp Cloud: send and receive one text and one image; template send; delivery status ticks. WhatsApp Web (staging session is `LOGGED_OUT`): not testable without a QR scan; record as not tested. Messenger: send from VerzChat and receive; Instagram: only if an account is connected. Telegram: connect only (no messaging exists). TikTok: section 3. For each: inbox filtering by channel, pagination, realtime event on a new message, attachment display, disconnect and reconnect, empty and error states. Tenant isolation: two tenants, each sees only its own conversations (inbox API and realtime room).

## 6. After acceptance: merge frontend quality
Dry run on 2026-11-04 against candidate HEAD `2a3a897`: 0 conflicts, typecheck 0 errors, 9 tests pass, lint 0 errors / 44 warnings. Merge `chore/frontend-quality` into `integration/staging-candidate-v2` only after sections 1-5 are recorded; it adds dev dependencies and a CI workflow and extracts `HistorySyncLine` into its own file (logic unchanged). It needs a second staging build to be exercised.

## 7. Backup trial checks (read-only; independent of the release)
First scheduled run: 2026-11-05 02:30 CET; monitor 08:15 CET.
```bash
vps 'tail -30 /var/log/verzchat-backup-v2.log | cut -c1-160; echo; cat /var/lib/verz-backup-v2/runs.log | tail -3; echo; tail -20 /var/log/verzchat-backup-v2-monitor.log; echo; ls -la /opt/backups/whatsapp-platform-v2 | tail; cat /var/lib/verz-backup-v2/ledger.tsv | tail -3'
```
Pass: a run recorded at 02:3x CET (not the manual one from 2026-11-04), `RESTORE-TEST: 6 pass, 0 fail` after that run's start marker, monitor `CHECK: 0 failure(s)` including "the 02:30 scheduled run happened today" and "existing 02:00 job is UNCHANGED", modes 600/700, dump size within 25% of the 02:00 dump, no ntfy alert. Daily thereafter for seven days; on any failure investigate without touching the 02:00 job (`/root/backup-postgres.sh`, `/etc/cron.d/verzchat-backup`, root crontab: hashes `aa0335a2…`, `9b399be4…`, `cb98617d…`). After seven successful days: restore the day-7 backup once more with `backup-restore-test.sh`, then write the cutover recommendation (not the cutover).

## 8. Cloudflare analytics request (for the IPv6 impact assessment)
Minimum: read-only Analytics access for the production zone (dashboard "Analytics & Logs" view role, or an API token with **Zone Analytics: Read** on that zone only; no DNS or settings permission). Needed data: HTTP 521/522/523/524 counts per 5-minute bucket for 3-7 days, requests by edge IP version if available, and origin response time. Method: check whether error spikes recur about every 9 minutes (stall ends were 543-551 s apart on 2026-11-04) and estimate the share of production traffic that arrives over IPv6 (about 10% in the nginx log). Do not change DNS, add AAAA records or disable IPv6 as part of this.

## 9. Evidence rules
One directory per phase under `/root/completion-programme-<date>/` (root-only, 700, sha256 manifest). Record command, timestamp and counts; never message text, tokens, OAuth codes, full state values or full customer identifiers. Keep failed runs.
