# Staging port 8443 firewall: runbook and acceptance record

Scope: the shared Contabo VPS (`84.247.142.49`) that hosts production AND staging. The staging nginx publishes port 8443; only Cloudflare (and a short-lived admin exception) may reach it.
Code: `infra/firewall/staging-8443/`. Status as of 2026-11-03: installed and live on staging, validated through AP-2 (B1-B4). **AP-3 (Docker restart + reboot) and AP-4 (old-layer retirement) are NOT done and need a production maintenance window.**

## 1. Architecture

Two independent layers filter the same traffic, and **a packet must be accepted by both**:

| Layer | Where | Priority | Notes |
|---|---|---|---|
| NEW: `inet staging8443` | nftables `forward` (IPv4 via Docker NAT) and `input` (IPv6 via docker-proxy) | -10 | atomic reload, fail-closed, self-repairing every 5 s |
| OLD: `STG-8443` / `STG-8443-V6` | iptables-nft: `DOCKER-USER` jump (`--ctorigdstport 8443`) and IPv6 `INPUT` position 1 | 0 | loads AFTER Docker; kept as the safety net |

Consequences: (a) while both exist, deleting the new table does not expose 8443, because the old layer still drops unauthorised sources; (b) a source allowed only by the new layer is still dropped
by the old one, so an admin exception works end-to-end only while the SAME address is in the old layer's `admin-ips.txt`; (c) once the old layer is retired the new table is the only guard, so its
fail-closed boot behaviour becomes essential (see section 7).

## 2. Admin access

The intended permanent admin path is an **SSH tunnel to the staging nginx loopback listener**: `ssh -L 127.0.0.1:18080:127.0.0.1:8080 root@<vps>` then `http://127.0.0.1:18080/health`.
It is independent of the gate and of the (dynamic) admin IP. The normal staging UI/API stays on Cloudflare. The admin exception is break-glass only and expires by itself.

UFW has `22/tcp LIMIT`: more than 5 new connections from one address in 30 s are **rejected**. Always use ONE multiplexed connection
(`ssh -fN -o ControlMaster=yes -o ControlPath=... -o ControlPersist=...`, then `-O forward` for the tunnel) and never retry in a loop.

**Never print, log or commit the admin address.** Listings (`nft list table`, `iptables-save`, `/etc/staging-8443/admin*.txt`, sshd/UFW logs) contain it; evidence that does is kept root-only on the server.

## 3. Installing and upgrading

See the package README. `install.sh` is idempotent, replaces files atomically, never overwrites `policy.conf`, restarts nothing, and has a `--check` mode.
Validated on a disposable Ubuntu 24.04 VM: upgrade from the earlier install (exactly one new file, no unit touched), second run installs nothing, fresh install from a bare system
(fail-closed until seeded), seeding from the live Cloudflare feed gave signature `471c8a8d90ccad70` (identical to production's), real reboot (gate loaded 1.85 s after boot, before
`network-pre.target`, containerd and Docker; no network activity by the boot unit).

## 4. Change protection: the watchdog

Use `staging-8443-fw-watchdog` whenever you change the live table by hand (anything beyond the normal `admin`, `refresh`, `verify` actions).

```bash
D=/root/wd-$(date -u +%Y%m%dT%H%M%SZ); mkdir -m 700 $D
nft list table inet staging8443 > $D/pre.nft
{ echo 'add table inet staging8443'; echo 'delete table inet staging8443'; cat $D/pre.nft; } > $D/rollback.nft
nft -c -f $D/rollback.nft                                   # must succeed
systemd-run --unit=stg-wd --collect -p IPAddressDeny=any -p 'RestrictAddressFamilies=AF_UNIX AF_NETLINK' \
  /usr/local/sbin/staging-8443-fw-watchdog $D 300           # arm: rolls back in 300 s unless cancelled
# ... make the change, verify it ...
touch $D/confirm        # cancel (change accepted)         |   touch $D/fail   # roll back NOW
```
Properties (all validated): runs as a transient unit in `system.slice` (survives loss of the SSH client), needs no network (runs with all IP traffic denied and only AF_UNIX/AF_NETLINK sockets),
restores the saved listing in one atomic transaction and then re-runs `staging-8443-fw boot` so admin timeouts are re-derived from `admin.txt` (a listing restore alone would extend the
exception by the elapsed time; reproduced at +54 s), never resurrects an exception that expired meanwhile, is bounded (boot step limited; 5.3 s with a held script lock, 0.3 s on `fail`),
is idempotent, and touches no other table. The comparison ignores counters, expiry timers and the admin sets.

## 4b. Recovery snapshots

`last-good` is the only snapshot the boot unit loads. A second, independent recovery copy can be pinned without touching anything live:

```bash
staging-8443-fw snapshot    # validated copy of last-good -> snapshots/<id>, pointer `recovery` (pinned against pruning); live table, last-good and policy untouched
staging-8443-fw status      # shows recovery_snapshot and previous_snapshot
staging-8443-fw recover     # if last-good is corrupt/unusable: validate `recovery` (refused if tampered), make it last-good, load it; refused while the rollback marker exists
```
Validated in isolation (38 checks): creation changes nothing live; restore after corrupting last-good restores the exact signature and keeps the admin exception's absolute expiry; a tampered recovery snapshot is refused with
nothing changed; pruning never removes the pinned snapshot (13 newer promotions); a refresh through a local feed and a `recover` afterwards round-trip. `promote()` no longer points `previous` at a deleted directory.

## 5. Acceptance record (2026-11-03)

| Stage | Result | Evidence |
|---|---|---|
| Install + 25-min server-side soak (51 samples, 30 s gaps, signature constant, verify gap max 6.4 s, 0 restarts, 0 nginx 5xx) | PASS | `verz-firewall-soak2-evidence-20261103`, `verz-firewall-install-evidence-20261103` |
| AP-1: Cloudflare allowed; unauthorised IPv4/IPv6 blocked; ports 80/443 unaffected; isolated script logic (fail-closed boot, drift repair, base-chain protection) | PASS (A2 admin-direct FAILED by design: the address is dynamic) | `verz-firewall-ap1-evidence-20261103` |
| AP-2 Phase 0: preflight 24/24, N1 old layer alone 8/8 | PASS | `verz-firewall-ap2-phase0-evidence-20261103` |
| B1: one atomic reload (0.3 s), no Cloudflare probe blocked, no exposure | PASS 7/7 | `verz-firewall-ap2-b1-evidence-20261103` |
| Watchdog, isolated: deadline/fail/deleted-table, confirm, SSH-session loss, no network | PASS 31/31 + 6/6 | `verz-firewall-ap2-wd2-validation-20261103` |
| Watchdog, HOST-DEFAULT path (private-netns sandbox over the default paths): expiry never extended, expired exception not resurrected, idempotent x3, bounded | PASS 65/65 + 5/5 | `verz-firewall-ap2-wd3-hostdefault-evidence-20261103` |
| B2: throwaway Docker bridge adds exactly 5 iptables rules (4 filter + 1 nat MASQUERADE), nothing removed, everything identical after removal | PASS 14/14 | `verz-firewall-ap2-b2-evidence-20261103` |
| B3-iso (packet-level admin TTL, scratch file) and B3-live (set membership/expiry/prune with reserved test addresses; ~1,230 Cloudflare-range probes never blocked) | PASS 7/7 + 12/12 | `verz-firewall-ap2-b3b4-evidence-20261103` |
| B4: live table deleted (5.6 s) and gate chain flushed (Cloudflare blocked 1.8 s, base-chain drops 19 fwd / 10 input) with the old layer as safety net; unauthorised never open | PASS 20/20 | same |

Open / not verified: real Cloudflare-to-origin IPv6 (the origin DNS record is not readable without the Cloudflare dashboard; retained logs show 0 of 7,107 requests over IPv6); a real boot and a
Docker restart on the production-shared VPS (AP-3); fail-closed boot with a corrupt snapshot on the VPS (verified only in the rehearsal VM and an isolated namespace).

## 6. AP-3: Docker restart and reboot (NEEDS A PRODUCTION MAINTENANCE WINDOW)

**Impact.** Docker has `live-restore=false` and all 18 containers (9 production, 9 staging) are `restart: always`. `systemctl restart docker` and a reboot stop and restart EVERY container, including production.
Estimates from the 2026-11-01 boot timeline (not measured under this change): Docker active ~20 s after it starts, containers up ~4 s after Docker starts, plus application warm-up: roughly 1-3 min for a Docker
restart and 2-5 min for a reboot.

**Preconditions (all required).** Announced window and a named person on call. Fresh database backups verified (production and staging). A recovery path that does not depend on SSH: the Contabo VNC console currently
REFUSES connections (it must be enabled in the Customer Panel and, per Contabo, the server rebooted before it works), so the fallback is the Contabo Customer Panel: Reboot and **Rescue System** (SSH as root into a live system,
mount the root disk, fix, reboot). Confirm you can log in to the panel BEFORE the window. No refresh timer within 24 h; admin exception not expiring inside the window; `acceptance/ap2-00-preflight.sh` all PASS;
`nftables.service` disabled (its `/etc/nftables.conf` begins with `flush ruleset` and would delete every table); rollback marker absent; `systemd-analyze verify` clean (it is today).

**Gate and verification scripts.** `acceptance/ap3-pre.sh <EV>` (read-only; any FAIL = NO-GO) checks invariants, a validated recovery snapshot, a fresh (< 2 h) valid production dump and a staging dump, no cron collision, unit hashes, and captures the pre-state
(boot id, timeline, containers, listeners, hashes). `acceptance/ap3-post.sh <EV> docker|reboot` verifies the result, including the gate-before-Docker ordering, real-packet access control in IPv4 and IPv6, ports 22/80/443/8080, and the old layer. Both were dry-run in steady state on 2026-11-04.

**Facts that shape the window (observed 2026-11-04).** Cron (server time CET): production DB backup 02:00 (`/root/whatsapp-platform/infra/scripts/backup.sh`), `certbot renew` 03:00 with an nginx reload post-hook, and a health check every 5 minutes
(`/usr/local/bin/verzchat-healthcheck.sh`) that runs `docker start` on `wa_nginx wa_backend wa_frontend wa_worker wa_realtime` if they are not running (harmless next to `restart: always`, but avoid a */5 tick). Latest production dump: `waplatform_20261103_020001.sql.gz` (77 MB, gzip OK, 105 tables);
staging release backup 9 h old (106 data entries). A manual fresh production dump is required immediately before the window. Suggested start: after 03:30 CET and not on a */5 minute. Production services interrupted: nginx (80/443), backend, frontend, realtime, worker,
whatsapp-web, postgres, redis, minio. **Risk to call out:** `wa_whatsapp_web` holds a live WhatsApp Web session; a stop that exceeds Docker's 10 s grace is SIGKILLed and the session may need to re-link. Meta Cloud API webhooks are retried by Meta, and Socket.io clients reconnect.

**C1: Docker restart.**
```bash
. lib.sh; . ap2-lib.sh; snap C1-before                         # acceptance/ helpers
# start the namespace prober (unauthorised sources must never connect) and the Mac-side probes (production, Cloudflare staging)
systemctl restart docker
until [ "$(docker ps -q | wc -l)" = 18 ]; do sleep 2; done; sleep 90
snap C1-after; cmpsnap C1-before C1-after
```
Pass: gate signature unchanged and counters NOT reset (the table is not reloaded); `DOCKER-USER` still jumps to `STG-8443`; old layer 21/13; 18 containers back, restart counts per `docker inspect` as expected;
unauthorised probes never connected; production and Cloudflare-staging health 200 after warm-up. Rollback: `systemctl start docker`; if a service stays down use the documented Compose procedure
(`docs/staging-release.md`); if the old jump is missing, `/usr/local/sbin/staging-8443-firewall apply`.

**C2: reboot.** `snap C2-before; systemctl reboot`. After the host returns (poll the SSH port at most once per 30 s: UFW limit), check: the gate finished BEFORE Docker started
(`systemctl show staging-8443-fw.service -p ExecMainExitTimestampMonotonic` < `systemctl show docker.service -p InactiveExitTimestampMonotonic`, and before every container `StartedAt`), signature `471c8a8d90ccad70`
in `snapshot` mode, no feed fetch in `journalctl -b -u staging-8443-fw.service`, units active and the verify timer running (~5 s), old layer re-applied after Docker (21/13), UFW and the four fail2ban jails,
18 containers healthy, admin exception still present, unauthorised sources blocked, Cloudflare path 200. Then run `acceptance/soak_monitor.py` (25 min) and a light 24 h re-check.
If SSH does not return within 10 min: Contabo panel > Reboot; still failing > Rescue System, mount the root disk, read `journalctl -D <root>/var/log/journal -b -u staging-8443-fw.service`; as a last resort remove
`/etc/systemd/system/sysinit.target.wants/staging-8443-fw.service` (the old layer keeps protecting 8443 once Docker is up) and reboot.

Failure behaviour already verified: `docker.service` has no `Requires=`/`BindsTo=` on the gate (ordering only), so a failed gate unit cannot block Docker; the worst case is old-layer-only protection.

## 7. AP-4: retiring the old iptables layer (DO NOT START UNTIL ALL OF THE FOLLOWING ARE TRUE)

1. AP-3 C1 and C2 passed, and a post-reboot soak (25 min plus a 24 h re-check) passed.
2. Real Cloudflare IPv6 status resolved: either an origin AAAA record exists and Cloudflare-sourced IPv6 requests were observed, or the origin is IPv4-only and that is recorded.
3. Fail-closed boot with a corrupt/missing snapshot has been tested on the real boot path (or accepted as a documented limitation): after retirement a missing gate means 8443 is exposed, because nothing else filters it.
4. A decision that defence-in-depth is not wanted. Recommendation: keep the old layer; it costs nothing and covers the table being absent.
5. No other dependency: the old unit is wanted only by `multi-user.target`; nothing else references `STG-8443` (checked). The admin exception stops needing the old `admin-ips.txt`.

Procedure (when approved): arm a watchdog variant that re-applies the old layer (`staging-8443-firewall apply`) unless confirmed; `snap` baselines; `systemctl disable --now staging-8443-firewall.service`
(its `ExecStop` removes the old chains and the jumps; nothing else is touched); verify with the namespace probes that unauthorised IPv4/IPv6 are blocked by the new table ALONE and Cloudflare-range sources pass;
re-run B3-live packet-level (an admin exception for a test address now works end-to-end); soak 25 min; keep the legacy scripts and unit file for 30 days. Rollback: `systemctl enable --now staging-8443-firewall.service`
(or `legacy-iptables/staging-8443-firewall apply`).

## 7b. Cloudflare IPv6 evidence (2026-11-04)

Observed: the VPS has a working global IPv6 (outbound ICMPv6 and TCP/443 succeed; default route present). Production nginx logs (2026-09-19 to 2026-11-03) contain **1,211 requests whose connecting address is a Cloudflare IPv6 address** (`2a06:98c0::/29`), i.e.
Cloudflare does reach this VPS over IPv6 for production on port 443. Staging port 8443: 7,116 retained requests, all IPv4 (5,035 from Cloudflare IPv4), none over IPv6. 40 real requests through Cloudflare to `https://verzchat.com:8443/api/v1/public/version` from an IPv4-only client also arrived
over IPv4. NOT verified: a real Cloudflare IPv6 connection to port 8443 and the staging origin DNS records (the Cloudflare API was not used: the only credential on the host is certbot's DNS-01 token, and using it for another purpose needs the owner's decision). Test that closes it: from an IPv6-capable client
(a phone on mobile data) open `https://verzchat.com:8443/api/v1/public/version` and `https://staging.verzchat.com:8443/api/v1/public/version`, then check `docker logs --since 5m wa_staging_nginx` for a connecting address inside `2400:cb00::/32`, `2606:4700::/32`, `2803:f800::/32`, `2405:b500::/32`, `2405:8100::/32`, `2a06:98c0::/29` or `2c0f:f248::/32`.
If Cloudflare mirrors the client's IP version, an IPv6 client will show IPv6; if the staging record has no AAAA, it will stay IPv4 (that is then the documented answer: the IPv6 gate path is verified with real Cloudflare prefixes but unused by staging).

## 8. Known risks and limitations

One validated recovery snapshot can be pinned with `staging-8443-fw snapshot` (done on staging 2026-11-04). A reload resets counters. The 5-second verify timer is journal-noisy (~20 lines/min). The admin exception expires 2026-11-10T19:13:50Z and is not to be renewed; the
SSH tunnel replaces it. `/etc/nftables.conf` contains `flush ruleset` (service disabled, must stay disabled). Docker restart/reboot behaviour on the shared VPS is validated only in isolation until AP-3.
