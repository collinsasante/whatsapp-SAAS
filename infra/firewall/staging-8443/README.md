# Staging port 8443 gate (native nftables)

One nftables table, `inet staging8443`, restricts TCP port 8443 (the staging nginx's published port) to Cloudflare's published ranges plus an optional, always-expiring
admin exception. It owns that table and nothing else: it never reads, edits or flushes any other table, chain or set (Docker, UFW, fail2ban are untouched).
The full runbook, acceptance record and the AP-3 / AP-4 procedures are in [`docs/STAGING_8443_FIREWALL.md`](../../../docs/STAGING_8443_FIREWALL.md).

| Property | How |
|---|---|
| IPv4 (Docker-NAT'd path) | `forward` hook, priority -10, matches `ct original proto-dst 8443` |
| IPv6 (docker-proxy path) | `input` hook, priority -10, matches `tcp dport 8443` |
| Atomic updates, both families | one `nft -f` transaction replaces the whole table |
| Loads before Docker, no network | `staging-8443-fw.service`: `DefaultDependencies=no`, `Before=docker.service containerd.service network-pre.target`, loads from the stored snapshot |
| Fail closed | no valid snapshot => deny-by-default table; base chains end in their own `drop`, so an emptied gate chain drops, not passes |
| Fail static | a refresh that cannot download/validate never touches the running rules or the last-known-good snapshot |
| Integrity | `staging-8443-fw-verify.timer` every 5 s: table, hooks, rules and range sets hashed; drift => repair from last-known-good + alert |
| Rollback | `staging-8443-fw-rollback` deletes only `inet staging8443` and writes a marker so nothing resurrects it |
| Change protection | `staging-8443-fw-watchdog`: SSH-independent automatic rollback of a risky live change (see the runbook) |

## Files

| File | Installed as |
|---|---|
| `staging-8443-fw`, `staging-8443-alert`, `staging-8443-fw-rollback`, `staging-8443-fw-watchdog` | `/usr/local/sbin/` (755) |
| `staging-8443-fw.service`, `-verify.service/.timer`, `-refresh.service/.timer`, `staging-8443-alert@.service` | `/etc/systemd/system/` |
| `policy.conf` | `/etc/staging-8443/policy.conf` (**never overwritten** if it exists) |
| `logrotate-staging-8443` | `/etc/logrotate.d/staging-8443` |
| `legacy-iptables/` | the ORIGINAL iptables layer (`STG-8443`, `STG-8443-V6`): kept as the safety net and rollback target; installed separately, not by `install.sh` |
| `acceptance/` | the live-acceptance harness (probers, B1-B4 scripts, soak monitor) |
| `tests/` | `run-local-checks.sh` (no server needed), `unit-tests.py` (validator), `b2-watchdog-selftest.sh` |

State lives in `/var/lib/staging-8443/` (snapshots, `last-good`, `previous`, `live.sig`, `status.json`); admin exceptions in `/etc/staging-8443/admin.txt`, managed only through `staging-8443-fw admin add|del|list`
(every entry expires; 30-day maximum).

## Install, upgrade, check

```bash
sudo ./install.sh --check        # change nothing; report differences (exit 1 if any)
sudo ./install.sh                # install or upgrade; atomic file replacement; restarts nothing
sudo ./install.sh --seed --enable   # first install only: fetch the first snapshot, enable the boot unit and the two timers
```
Idempotent: a second run installs nothing and touches no unit. An existing `policy.conf` is never overwritten. A first start with no snapshot comes up **fail-closed**
(deny-by-default) until `staging-8443-fw refresh` has stored a validated snapshot.

## Operations

```
staging-8443-fw status                       # table, last-good, signatures, last refresh, admin entries (addresses hidden)
staging-8443-fw refresh                      # fetch -> validate -> nft -c -> atomic load -> post-check -> promote
staging-8443-fw admin add <ip> --ttl 7d      # temporary exception (prefer an SSH tunnel to 127.0.0.1:8080)
staging-8443-fw-rollback                     # remove the gate (only its own table)
staging-8443-fw restore && systemctl enable --now staging-8443-fw.service staging-8443-fw-verify.timer staging-8443-fw-refresh.timer
```

## Tests

```bash
bash tests/run-local-checks.sh   # syntax, compile, 38 validator cases, policy sanity, (Linux) B2 watchdog self-test, no-secret check
```
Install/upgrade/idempotency/boot-order checks and the live acceptance are described in the runbook.
