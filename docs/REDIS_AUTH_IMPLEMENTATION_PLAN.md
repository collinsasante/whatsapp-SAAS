# Redis authentication: implementation plan (production)

Status: **plan only. Nothing here has been applied to any server.** Staging first, production only on explicit approval in a maintenance window.
Rollback is a separate document: `REDIS_AUTH_ROLLBACK_PLAN.md`.

## Why

Production Redis (`wa_redis`, redis 7.4.9) runs with `user default on nopass`, `protected-mode no`, `bind *`. It is not published to the host and a TCP probe from outside found 6379 closed, but it shares one Docker network (`verzchat-prod_platform-network`) with nine other containers, including the internet-facing frontend and nginx. A compromise of any of them gives unauthenticated read and write access to every BullMQ queue (job payloads, repeatable jobs) and the AI rate-limit and simulation state.

## Facts established (read-only, 2026-11-05)

| Fact | Consequence |
|---|---|
| The apps already send `REDIS_PASSWORD` (backend, worker, realtime: compose lines passing `${REDIS_PASSWORD}`); the server ignores it. The same value is on all three. whatsapp-web has no Redis settings. | Clients need no code change; they need the new value at recreate. |
| The current value is **9 characters**. | Do not simply enforce it. Generate a new strong value and recreate Redis and its three clients together. |
| The container healthcheck is `redis-cli ping` with no credentials. | Put `REDISCLI_AUTH` in the Redis container's environment so the same healthcheck authenticates (verified locally: PONG with the variable, `WRONGPASS` for a wrong or missing password). |
| `infra/scripts/backup.sh` already reads `REDIS_PASSWORD` and passes it as `REDISCLI_AUTH` through `docker exec -e` (never on a command line). | No change. Its "Redis accepts unauthenticated connections" warning disappears once enforced. `/opt/verz-backup-v2` calls `redis-cli` too: **check it before the window** (see pre-flight). |
| Production `wa_backend` carries hot-swapped code in its container layer. | **Never** recreate the backend with a plain `docker compose up`. Use `infra/scripts/production-recreate.sh`, which commits the running backend into its image first. |
| `requirepass` on the command line shows in `docker inspect` Cmd. | Pass it through the environment and `exec redis-server … --requirepass "$REDIS_PASSWORD"` inside `sh -c`: Cmd shows no password (verified locally); it is in the container's Env, visible only to root. |

## Local rehearsal already done (no server touched)

Real `redis:7.4` container with `--requirepass` from the environment, using the repository's own BullMQ and ioredis: a queue job completed (round trip) with the password; a wrong password and no password were both refused; the unchanged `redis-cli ping` healthcheck returned PONG with `REDISCLI_AUTH` set; the password did not appear in `docker inspect` Cmd. Container removed afterwards.

## Compose change (prepared, not applied)

`infra/docker-compose.yml`, service `redis` (the staging file gets the same change):

```yaml
  redis:
    image: redis:7-alpine
    container_name: wa_redis
    restart: always
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
      REDISCLI_AUTH: ${REDIS_PASSWORD}          # lets the healthcheck and docker exec redis-cli authenticate
    command: ["sh", "-c", "[ -n \"$$REDIS_PASSWORD\" ] || exit 1; exec redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy noeviction --requirepass \"$$REDIS_PASSWORD\""]
```

The `${…:?}` guard and the `[ -n … ]` test make an empty password a start-up failure instead of silently starting an open Redis. The healthcheck stays `redis-cli ping`.

## Steps

**0. Approval and window.** Written approval, an off-peak window, and someone able to watch the app. Expected impact: queues and realtime are unavailable for roughly 30 to 90 seconds; inbound WhatsApp webhooks arriving in that gap are retried by Meta; agent sends in that gap fail and must be retried by the agent.

**1. Rehearse on staging first** with the identical change (staging has its own Redis and `.env.staging`). Do not proceed until staging passes every check in step 6.

**2. Pre-flight on production (read-only).**
- `bash infra/scripts/production-recreate.sh check backend worker realtime redis` must end without an `ABORT`.
- Confirm `/opt/verz-backup-v2/backup.sh` authenticates (read its `redis-cli` calls) or is run with `REDIS_PASSWORD` in its environment; otherwise its Redis snapshot step fails after the change.
- Record baselines: `connected_clients`, queue lengths (`bull:<queue>:wait|active|delayed|failed`), 10 minutes of webhook counts.
- Take a fresh backup: `bash infra/scripts/backup.sh` (database plus Redis snapshot), and copy the data volume: `docker run --rm -v infra_redis_data:/d -v /root/redis-pre-auth:/out alpine tar czf /out/redis-data.tgz -C /d .` (mode 700 directory).

**3. Generate the new password (operator, never printed).**
```
umask 077
openssl rand -base64 36 | tr -d '\n=+/' > /root/redis-password.new       # about 48 characters, no characters that need quoting
test "$(wc -c < /root/redis-password.new)" -ge 32 && echo "length OK"
```
Store a copy in your password manager first. Keep the previous `.env` as `.env.pre-redis-auth` (mode 600).

**4. Install (operator).** Edit `/root/whatsapp-platform/infra/.env` in an editor and replace the value of `REDIS_PASSWORD`, or: `sed -i.pre-redis-auth "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(cat /root/redis-password.new)|" /root/whatsapp-platform/infra/.env` (the substitution is expanded by the shell, not shown). Apply the compose change from above (a reviewed git commit on the server checkout, or the approved patch).

**5. Apply.**
`CONFIRM_PRODUCTION=yes bash infra/scripts/production-recreate.sh apply redis backend worker realtime` (the script snapshots the backend environment, commits the running backend so its code is kept, recreates the listed services without dependencies, waits, and reports webhook responses). If the script does not accept `redis` as a service in `check`, stop and fix the script first rather than improvising with `docker compose up`.

**6. Verify (all must hold).**
- `docker exec wa_redis redis-cli ping` (container env supplies the credential) returns `PONG`; `docker exec -e REDISCLI_AUTH= wa_redis redis-cli ping` is refused; the container is `healthy`.
- No `NOAUTH`, `WRONGPASS` or `ECONNREFUSED` lines in `wa_backend`, `wa_worker`, `wa_realtime` logs since the restart.
- Queue lengths and `connected_clients` are back to the baseline; `sla-monitor` and the other repeatable jobs run again.
- `bash infra/scripts/production-recreate.sh webhooks 5` reports webhooks accepted; one real inbound message and one agent reply work (a human, on a test conversation).
- `bash infra/scripts/backup.sh` completes and its Redis snapshot is valid; `/opt/verz-backup-v2` runs clean.
- `docker inspect wa_redis --format '{{.Config.Cmd}}'` contains no password.

**7. Close.** Delete `/root/redis-password.new` only after the password manager copy is confirmed. Remove `.env.pre-redis-auth` and the backend env snapshot only when the change is accepted (do not delete backups without the owner's approval).

## Later hardening (not part of this change)

Put Redis and Postgres on an internal data network that nginx and the frontend do not join; add per-service Redis ACL users; rotate the password on the same schedule as other secrets.
