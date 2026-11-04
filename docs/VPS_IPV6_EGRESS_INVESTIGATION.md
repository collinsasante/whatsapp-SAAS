# Intermittent IPv6 stalls on the shared VPS (2026-11-04)

## Summary

The VPS loses IPv6 connectivity for **about 40 seconds roughly every 9 minutes** (stall ends observed 547.6, 543.1, 544.9 and 551.0 seconds apart). IPv4 is unaffected. During a stall, connections to **any** IPv6 destination hang (the staging hostname through Cloudflare, another Cloudflare address, a non-Cloudflare host), which is what looked like "slow IPv6 connect and TLS failures when the VPS connects to staging through Cloudflare". Connectivity returns the instant the VPS kernel sends a **multicast neighbor solicitation from its global address** to the default gateway.

| Claim | Confidence |
|---|---|
| The cause is **not** DNS, TLS, the staging hostname, Cloudflare, the staging origin or the inbound nftables/iptables gate | High |
| The stalls are on the VPS's IPv6 path to the provider's gateway and are periodic (about 546 s) | High |
| The VPS-side recovery takes 40-44 s because the kernel only re-resolves the gateway after its neighbor entry goes STALE, PROBE and FAILED | High (3 fully captured episodes) |
| The stall **starts** because of something in the provider's network (a virtual router or SDN layer) | Medium: consistent with every observation, not directly observable from the VPS |
| The provider router's unanswered probes for this NIC's EUI-64 address (an address not configured on the VPS) are involved in the trigger | Low to medium: tightly correlated (every captured stall), but its order relative to the start of the silence varies (+4.9 s, -3.0 s, -22.6 s), so causation is **not** established |

No root cause is claimed beyond "periodic loss of IPv6 delivery between this VM and its provider gateway, outside the staging firewall gate". Nothing was changed on the VPS to investigate or to work around it.

## Scope and constraints
Read-only observation. No DNS, Cloudflare, firewall, nftables, Docker or production change; no AAAA record; IPv6 not disabled; the staging origin's address unchanged.

## Method
`infra/scripts/diagnostics/ipv6-egress-probe.sh` (one cycle about every 18 s) measured, separately: lookup through the local stub resolver and straight to both upstream resolvers; `curl -6` by hostname; `curl -6` to a **pinned address** (no DNS involved); `curl -4` by hostname; ICMP to the edge and to the gateway; TCP retransmission counters. The order of the three HTTP probes rotates every cycle. A companion probe added three destinations that are not the staging hostname: another Cloudflare IPv6 address, a non-Cloudflare IPv6 host, and an IPv4 host. A header-only packet ring buffer (TCP SYN/RST, ICMPv6, DNS) and a netlink neighbor-event monitor recorded what the kernel and the wire did. 166 cycles over about 55 minutes; 5 stall episodes.

Instrument defects found and fixed, with the faulty evidence kept: the first probe script failed to parse on macOS bash 3.2 (`case` inside `$(...)`); the first capture failed to start (tcpdump drops root); the first capture's BPF expression **did not match IPv6 TCP** (0 SYNs captured even in healthy cycles), which invalidated my first inference ("no SYN was sent during the stall"); that inference was withdrawn and the filter replaced with a byte-offset match. Only the ICMPv6 half of the first capture is used as evidence.

## Results
| Probe | n | failed | slow successes (>1 s) | max connect |
|---|---|---|---|---|
| IPv6 by hostname (staging via Cloudflare) | 166 | 4 | 1 | 10.6 s |
| IPv6 pinned address (no DNS) | 166 | 3 | 2 | 11.2 s |
| IPv6 other Cloudflare address | 99 | 3 | 0 | |
| IPv6 non-Cloudflare host | 99 | 2 | 1 | 10.4 s |
| **IPv4 by hostname** | 166 | **0** | 0 | 0.09 s |
| **IPv4 non-Cloudflare host** | 99 | **0** | 0 | 0.30 s |

Stall ends (UTC): 10:52:40.8, 11:01:48.4, 11:10:51.5, 11:19:56.4, 11:29:07.4. Earlier un-instrumented sightings fit the same rhythm (about 10:31, 10:42).

### What was ruled out, and how
| Candidate | Evidence |
|---|---|
| DNS | Stub lookups 0-70 ms and upstream 1-1677 ms, no timeout or error in 166 cycles; failures occur identically for the **pinned address** where DNS is not involved. (An early guess that curl's cumulative `time_connect` hid a DNS delay was tested and rejected.) |
| TLS | Failures are at TCP connect (curl exit 28, `conn=0`) or a connect that completes only after 7-11 s; the TLS errors seen (exit 35) are a consequence of the late connect. |
| The staging hostname, Cloudflare, the origin | A non-Cloudflare IPv6 host and a different Cloudflare address stall in the **same cycles**; IPv4 to the same hostnames never stalls. |
| The inbound staging gate | The gate matches only inbound `tcp dport 8443` / `ct original proto-dst 8443` and has no output hook or source-port match; so it cannot affect connections the VPS initiates; destinations unrelated to staging stall in the same cycles. |
| Host address or timers | The IPv6 address has `valid_lft forever`; static netplan, no DHCPv6, no router advertisements (`accept_ra=0`); no host timer with a 9-minute period (the 10-minute sysstat timer's offsets do not line up and it does no network I/O). |
| NIC or hypervisor events | `virtio_net` on KVM; no link flaps, NIC errors or guest-tools events; the promiscuous-mode lines are tcpdump restarts. |

### The packet-level signature (identical in the three fully captured episodes: 12:10, 12:19, 12:28 CET)
1. Inbound IPv6 data stops while the VPS keeps sending SYNs (to the correct gateway MAC; the cached MAC never changed). Inbound IPv6 silence lasted 43.6, 40.0 and 40.9 s. IPv4 flowed normally.
2. The provider router sends three neighbor solicitations, 5 s apart, for this NIC's **EUI-64 address, which is not configured on the VPS** (the VPS uses a static `::1` address), so nobody answers. At other times it sends a single solicitation for the configured address, which the VPS answers, and no stall follows.
3. The kernel's gateway entry goes STALE, then PROBE: three unicast solicitations from the link-local source go unanswered over 3 s, then FAILED.
4. The kernel sends a **multicast solicitation from the global address**; the gateway answers in about 2 ms; the entry is REACHABLE; **one millisecond later the first pending SYN-ACKs arrive**.

## Impact
* **Staging:** none from this. Cloudflare reaches the staging origin over IPv4 (verified earlier); only requests the VPS itself makes over IPv6 stall.
* **Production:** IPv6 is unavailable about 7.5% of the time (40-44 s in every 546 s). Any IPv6 client of production, including a Cloudflare IPv6 connection to the origin if production has an AAAA record, could see failures or fallbacks during a stall. About 10% of production requests arrive over IPv6 (1,148 of about 11,560 in three hours), too few per 10 s to show a dip in the origin's access log, and failed connections never reach nginx. **Unquantified**: the Cloudflare dashboard (521/522 errors at a roughly 9-minute rhythm) or an external IPv6 client would show it.
* **The VPS itself:** other IPv6 egress (for example NTP, which timed out over IPv6 at boot and fell back to IPv4) is affected.

## Options (none applied; each needs the owner's approval)
1. **Open a ticket with the provider** with this evidence (a request, no change). Recommended first.
2. **Shorten the VPS-side recovery** by tuning the kernel's neighbor timers (`base_reachable_time_ms`, `delay_first_probe_time`, `ucast_solicit`, `retrans_time_ms`): a sysctl change that could cut a 40 s stall to roughly 10 s. Needs a test with rollback.
3. **A small keepalive** that sends the multicast solicitation periodically (a new systemd unit).
4. **Configure the EUI-64 address** so the router's probes are answered (changes the VPS's addressing; could be tested to see whether the stalls disappear, which would also strengthen the diagnosis).
5. Leave as is.

Explicitly **not** done and not recommended as a workaround: adding an AAAA record for the staging origin, disabling IPv6, or any change to Cloudflare or DNS.

## Remaining uncertainty
Why the silence starts, and what the router's EUI-64 probes mean, cannot be determined from inside the VM. The provider's network is not observable. Only one VPS and a single hour were observed; the 9-minute period could change.

## Evidence
`/root/ipv6-investigation-20261104T104312Z/` on the VPS (root-only, 30 files, manifest sha256 `afc885af78606d70`): `probes.log`, `extra.log`, `neigh-events.log`, `ring2.pcap0` (corrected capture), `ring-v1-FILTER-DEFECT-no-ipv6-tcp.pcap0` (kept, ICMPv6 half only), `anomalies.log`, the probe script versions that ran, `run2/` (queued and stopped before it started), and the analysis scripts. Probes were stopped after five episodes.
