# Provider support case: periodic loss of IPv6 delivery on a KVM VPS

Prepared 2026-11-04 for the VPS provider (Contabo). Sanitised: the server's public addresses are replaced by placeholders (`<VPS-IPV4>`, `<VPS-IPV6>`); the full evidence set is in the customer's root-only evidence directory and can be supplied on request. Nothing was changed on the server to produce this.

## Summary
The VPS loses IPv6 connectivity for **about 40 seconds roughly every 9 minutes (observed period 543-551 s)**. IPv4 on the same interface is unaffected. During the stall, TCP connections to any IPv6 destination hang; delivery resumes the moment the guest sends a multicast neighbor solicitation from its global address to the default gateway `fe80::1`.

## Environment
* Ubuntu, kernel 6.8, KVM guest, `virtio_net`, interface `eth0`, MTU 1500.
* Static netplan configuration: one global IPv6 address `<VPS-IPV6>/64` (interface id `::1`), default route via `fe80::1` on-link. No DHCPv6, no router advertisements accepted (`accept_ra=0`), address lifetime `forever`.
* Host firewall does not filter outbound traffic and cannot affect connections the VPS initiates.

## Observations (2026-11-04, five consecutive episodes, 166 probe cycles)
* IPv6 probes failing or slower than 1 s: toward a Cloudflare-proxied hostname (4 of 166), toward a different Cloudflare address (3 of 99), toward a non-Cloudflare host (2 of 99). **IPv4 probes: 0 failures in 265.** Stall ends (UTC): 10:52:40.8, 11:01:48.4, 11:10:51.5, 11:19:56.4, 11:29:07.4.
* Packet capture on `eth0` (episodes at 12:10, 12:19 and 12:28 CET): inbound IPv6 TCP data stops for 43.6, 40.0 and 40.9 s while the guest keeps sending SYNs to the gateway's MAC.
* Around the start of each stall the gateway/router (global source address `<ROUTER-V6>`, MAC `<ROUTER-MAC>`) sends **three neighbor solicitations 5 s apart for the guest's EUI-64 address derived from the NIC MAC, which is not configured on the guest** (the guest uses `::1`) and therefore never answers. At other times it sends one solicitation for the configured address and the guest answers it.
* The guest's neighbor entry for `fe80::1` then goes STALE, PROBE (three unicast solicitations over 3 s, unanswered), FAILED; the guest then sends a **multicast solicitation from its global address**; `fe80::1` answers within about 2 ms; the entry becomes REACHABLE; the first pending SYN-ACKs arrive 1 ms later.
* Pings to `fe80::1` are never answered (100% loss), also outside stalls.

## What was ruled out
DNS (pinned-address requests fail identically), TLS, the destination hostname/CDN, the guest firewall, address lifetime/DHCPv6/RA, host timers, NIC errors or link flaps.

## Questions for the provider
1. Does your network (virtual router, SDN or anti-spoofing layer) perform neighbor discovery or a reachability probe with a ~9-minute period for this VM, and why does it solicit the EUI-64 address instead of the assigned `<VPS-IPV6>`?
2. Is a per-VM IPv6 neighbor or MAC/IP binding table refreshed on that cadence, and could an entry for the assigned address be expiring and being relearned only on the guest's multicast solicitation?
3. Should the guest be configured differently (for example the EUI-64 address in addition, an RA-based configuration, or specific neighbor timers) for your platform?
4. Is the same behaviour seen on other VMs on this node? Please check node-level logs for this VM around the timestamps above.

## Timestamps for your logs (UTC unless stated)
Stall ends: 2026-11-04 10:52:40, 11:01:48, 11:10:51, 11:19:56, 11:29:07. Packet-level episodes: 12:10:07-12:10:51, 12:19:16-12:19:56, 12:28:26-12:29:07 (CET = UTC+1 on the capture host).

## Requested outcome
A root cause on the provider side or a recommended guest configuration, and confirmation once resolved.

## Not yet quantified (customer-side)
Production impact of the stall on IPv6 clients of the site (about 10% of production requests arrive over IPv6). Cloudflare 52x analytics for the zone would measure it; no Cloudflare analytics access was available to this analysis.
