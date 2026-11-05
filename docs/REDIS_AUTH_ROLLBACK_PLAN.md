# Redis authentication: rollback plan (production)

Applies to `REDIS_AUTH_IMPLEMENTATION_PLAN.md`. **Plan only; nothing applied.** Written to be used under pressure: the fastest safe step first.

## Why rollback is cheap

The apps already sent a password to a Redis that ignored it. If Redis is put back without `requirepass`, every client keeps working exactly as it did before the change, **without being recreated**: ioredis answers an unneeded `AUTH` with a warning and carries on. Data is persisted by the append-only file in the `infra_redis_data` volume, which a Redis recreate does not touch.

## Decide to roll back when any of these is true

- `wa_redis` is not `healthy` two minutes after the change.
- `NOAUTH`, `WRONGPASS` or `ECONNREFUSED` lines keep appearing in `wa_backend`, `wa_worker` or `wa_realtime` logs.
- Queue lengths do not return to baseline, repeatable jobs do not run, or realtime clients cannot connect.
- `production-recreate.sh webhooks` reports rejected webhooks, or an inbound message or an agent reply fails.
- Backups of Redis start failing and cannot be fixed within the window.

## Level 1: instant, no restart (Redis keeps running)

Needs the new password, which the operator has in the password manager and in `/root/redis-password.new` until step 7 of the implementation.

```
REDISCLI_AUTH="$(cat /root/redis-password.new)" docker exec -e REDISCLI_AUTH wa_redis redis-cli CONFIG SET requirepass ""
```
Takes effect immediately for new connections; existing connections are unaffected. It does **not** survive a Redis restart (the compose command would re-enable it), so follow with Level 2 as soon as the incident is calmer.

## Level 2: put Redis back as it was (about 30 seconds)

1. Restore the previous compose file and settings: `cp /root/whatsapp-platform/infra/docker-compose.yml.pre-redis-auth /root/whatsapp-platform/infra/docker-compose.yml` (keep that copy in step 4 of the implementation) and, only if the clients cannot connect to a passwordless Redis (they can), `cp infra/.env.pre-redis-auth infra/.env`.
2. Recreate only Redis: `cd /root/whatsapp-platform/infra && docker compose --env-file .env -f docker-compose.yml up -d --no-deps --no-build --force-recreate redis`.
3. Verify: `docker exec wa_redis redis-cli ping` returns `PONG`; clients reconnect on their own; queue lengths match the baseline; `production-recreate.sh webhooks 5` shows webhooks accepted.

The backend, worker and realtime do **not** need recreating for a rollback, and the backend must never be recreated with a plain `docker compose up` (its hot-swapped code lives in the container; use `production-recreate.sh`).

## Level 3: Redis data damaged or queues lost (unlikely)

Symptoms: Redis will not start, or `bull:*` keys are missing after the restart.
1. Stop Redis: `docker stop wa_redis`.
2. Restore the volume copy taken in pre-flight: `docker run --rm -v infra_redis_data:/d -v /root/redis-pre-auth:/in alpine sh -c 'rm -rf /d/* && tar xzf /in/redis-data.tgz -C /d'`.
3. Start Redis as in Level 2, then verify. Jobs enqueued between the backup and the incident are lost; the database is the source of truth, and repeatable jobs re-register themselves when the worker starts.

## Level 4: the whole change must be undone

Restore `.env` and the compose file from the `.pre-redis-auth` copies, then `CONFIRM_PRODUCTION=yes bash infra/scripts/production-recreate.sh apply redis backend worker realtime`, and verify as above. Report what failed so the plan can be corrected before another attempt.

## After any rollback

Record the time, the trigger, the log lines and the queue lengths. Do not leave `requirepass ""` in place as a steady state: Redis is back to its previous (unauthenticated) exposure and the issue stays open.
