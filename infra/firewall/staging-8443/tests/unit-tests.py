#!/usr/bin/env python3
"""Validator unit tests (production policy defaults, no network, no nft)."""
import importlib.machinery, importlib.util, os, sys
# Default: the script next to this tests/ directory; override with STG8443_FW_PATH to test an installed copy.
FW_PATH = os.environ.get("STG8443_FW_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "staging-8443-fw"))
loader = importlib.machinery.SourceFileLoader("fw", FW_PATH)
spec = importlib.util.spec_from_loader("fw", loader); fw = importlib.util.module_from_spec(spec); loader.exec_module(fw)
P = dict(fw.POLICY)  # production defaults
REAL4 = "173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22".split()
REAL6 = "2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32".split()
ok = bad = 0
def expect(name, fn, accept):
    global ok, bad
    try: fn(); got = True
    except fw.V as e: got = False; why = str(e)[:70]
    good = (got == accept); ok += good; bad += (not good)
    print(("PASS " if good else "FAIL ") + f"{name}" + ("" if got else f"  [rejected: {why}]"))
expect("REAL Cloudflare IPv4 list (15 ranges) accepted", lambda: fw.parse_ranges("\n".join(REAL4) + "\n", 4, P), True)
expect("REAL Cloudflare IPv6 list (7 ranges) accepted", lambda: fw.parse_ranges("\n".join(REAL6) + "\n", 6, P), True)
expect("CRLF line endings tolerated", lambda: fw.parse_ranges("\r\n".join(REAL4) + "\r\n", 4, P), True)
def with_extra(base, extra, fam): return lambda: fw.parse_ranges("\n".join(base + [extra]) + "\n", fam, P)
for name, extra in [("0.0.0.0/0 (allow-all)", "0.0.0.0/0"), ("10.0.0.0/8 (private)", "10.0.0.0/8"), ("192.168.1.0/24 (private)", "192.168.1.0/24"),
                    ("127.0.0.0/8 (loopback)", "127.0.0.0/8"), ("169.254.0.0/16 (link-local)", "169.254.0.0/16"), ("224.0.0.0/4 (multicast)", "224.0.0.0/4"),
                    ("198.51.100.0/24 (documentation)", "198.51.100.0/24"), ("100.64.0.0/10 (shared space)", "100.64.0.0/10"),
                    ("8.0.0.0/8 (too broad)", "8.0.0.0/8"), ("1.2.3.0/33 (bad prefix)", "1.2.3.0/33"), ("999.999.999.999/24", "999.999.999.999/24"),
                    ("1.2.3.4 (no prefix)", "1.2.3.4"), ("1.2.3.4/24 (host bits set)", "1.2.3.4/24"), ("shell injection '1.2.3.0/24; drop'", "1.2.3.0/24; drop"),
                    ("an IPv6 range in the IPv4 list", "2400:cb00::/32"), ("HTML error page line", "<html>"), ("comment text", "# nope")]:
    expect(f"IPv4 list + {name} rejected", with_extra(REAL4, extra, 4), False)
for name, extra in [("::/0 (allow-all)", "::/0"), ("fe80::/10 (link-local)", "fe80::/10"), ("fc00::/7 (unique local)", "fc00::/7"), ("::1/128 (loopback)", "::1/128"),
                    ("ff00::/8 (multicast)", "ff00::/8"), ("2001:db8::/32 (documentation)", "2001:db8::/32"), ("2000::/3 (too broad)", "2000::/3"),
                    ("2400:cb00::/999", "2400:cb00::/999"), ("zzzz::/32", "zzzz::/32"), ("an IPv4 range in the IPv6 list", "1.2.3.0/24")]:
    expect(f"IPv6 list + {name} rejected", with_extra(REAL6, extra, 6), False)
expect("empty IPv4 file rejected", lambda: fw.parse_ranges("", 4, P), False)
expect("whitespace-only file rejected", lambda: fw.parse_ranges("\n \n", 4, P), False)
expect("truncated IPv4 list (3 ranges) rejected", lambda: fw.parse_ranges("\n".join(REAL4[:3]), 4, P), False)
expect("IPv4 list over the count limit rejected", lambda: fw.parse_ranges("\n".join(f"100.{128+i//250}.{i%250}.0/24" for i in range(80)), 4, P), False)
expect("oversized feed rejected", lambda: fw.parse_ranges("1.0.0.0/24\n" * 20000, 4, P), False)
expect("delta: dropping 60% of the current ranges rejected", lambda: fw.check_delta(REAL4[:6], REAL4, 4), False)
expect("delta: dropping 1 of 15 accepted", lambda: fw.check_delta(REAL4[:14], REAL4, 4), True)
expect("delta: adding ranges accepted", lambda: fw.check_delta(REAL4 + ["100.128.9.0/24"], REAL4, 4), True)
print(f"\n{ok} passed, {bad} failed"); sys.exit(1 if bad else 0)
