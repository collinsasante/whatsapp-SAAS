# Live acceptance harness

Scripts used for the 2026-11-03 staging acceptance (see docs/STAGING_8443_FIREWALL.md section 5 for results). They are meant to be STAGED into a fresh root-only evidence directory on the VPS and run as
transient systemd units; none of them is installed by `install.sh`.

* Stage: copy `lib.sh ap2-*.sh prober_*.py analyze.py extra.sh` into `$EV` (mode 700 dir). The tests use `$EV/ap2-b1-watchdog.sh` unless `WATCHDOG=/usr/local/sbin/staging-8443-fw-watchdog` is set
  (stage a copy of `../staging-8443-fw-watchdog` under that name, or set the variable to test the installed file).
* Environment-specific constants (expected signature, snapshot, admin expiry, evidence directory of the previous stage) are overridable: `EXPECT_SIG`, `EXPECT_SNAP`, `EXPECT_ADMIN_EXP`, `AP1`, `ADMIN_BK`.
* `ap2-00-preflight.sh` first; `ap2-01-n1-old-layer-alone.sh` proves the old layer alone; B1-B4 in order; `ap2-99-post.sh` seals evidence. B3-live and B4 change the live gate: arm
  `staging-8443-fw-watchdog` first and read the runbook.
* Never print the admin address: `ap2-lib.sh` keeps a root-only copy of the real admin line OUTSIDE the evidence directory and compares it byte-for-byte.
* `mac-probes.sh` runs on the operator's Mac through one multiplexed SSH connection (UFW rate-limits port 22).
